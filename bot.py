import asyncio
import os
import sys
import aiohttp
from aiohttp import web
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.functions.channels import JoinChannelRequest
from cleaner import clean_content
from config_manager import load_config, save_config

# Path to local session storage
SESSION_FILE_PATH = os.path.join(os.path.dirname(__file__), "forwardmate_user")
RENDER_PUBLIC_URL = os.environ.get("RENDER_EXTERNAL_URL", "https://forward-mate.onrender.com")

# Dummy health check server + Self-Keep-Alive Pinger to prevent Render Free Tier sleep!
async def start_dummy_health_server():
    port = int(os.environ.get("PORT", 8080))
    app = web.Application()
    async def health(request):
        return web.Response(text="Forward Mate Bot is Running 24/7 (Never Sleeps)!")
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"[*] Health server listening on 0.0.0.0:{port}")

async def keep_alive_pinger():
    """
    Pings the public Render URL every 5 minutes so Render Free Tier never spins down
    due to 15-minute HTTP inactivity.
    """
    await asyncio.sleep(10)
    url = f"{RENDER_PUBLIC_URL.rstrip('/')}/health"
    print(f"[*] Starting 24/7 Keep-Alive Pinger targeting: {url}")
    while True:
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(url, timeout=15) as resp:
                    pass
        except Exception:
            pass
        await asyncio.sleep(300)  # Ping every 5 minutes

async def forward_single_message(client, msg, route, target_entity, src_title, tgt_title):
    """
    Cleans and forwards a single message or media post to target_entity.
    """
    original_text = msg.message or ""
    cleaned_text, meaningful = clean_content(
        text=original_text,
        remove_links=route.get("remove_links", True),
        strip_signatures=route.get("strip_signatures", True),
        signatures=route.get("signatures", []),
        source_handle=route.get("source", "")
    )

    has_media = bool(msg.media)
    if not has_media and not meaningful:
        print(f"  [⏩ Skipped] Post contained only promo links or signatures.")
        return False

    try:
        if has_media:
            await client.send_file(
                entity=target_entity,
                file=msg.media,
                caption=cleaned_text if meaningful else None
            )
        else:
            await client.send_message(
                entity=target_entity,
                message=cleaned_text
            )
        print(f"  [✅ Successfully Published] Cleaned & sent to: {tgt_title}")
        return True
    except Exception as send_err:
        print(f"  [❌ Delivery Failed to {tgt_title}]: {send_err}")
        return False

async def forward_album(client, chat, grouped_id, route, target_entity, src_title, tgt_title):
    """
    Collects all items of a grouped media album, cleans the caption, and publishes as an album.
    """
    recent_msgs = await client.get_messages(chat, limit=15)
    album_items = [m for m in recent_msgs if m.grouped_id == grouped_id]
    if not album_items:
        return False

    raw_caption = ""
    for m in album_items:
        if m.message:
            raw_caption = m.message
            break

    cleaned_caption, _ = clean_content(
        text=raw_caption,
        remove_links=route.get("remove_links", True),
        strip_signatures=route.get("strip_signatures", True),
        signatures=route.get("signatures", []),
        source_handle=route.get("source", "")
    )

    album_files = [m.media for m in reversed(album_items) if m.media]
    if not album_files:
        return False

    try:
        await client.send_file(
            entity=target_entity,
            file=album_files,
            caption=cleaned_caption if cleaned_caption else None
        )
        print(f"  [✅ Successfully Published Album] {len(album_files)} items to: {tgt_title}")
        return True
    except Exception as album_err:
        print(f"  [❌ Failed Album Delivery to {tgt_title}]: {album_err}")
        return False

async def main():
    print("=" * 65)
    print("      [*] FORWARD MATE -- 24/7 HYBRID REALTIME + POLLER BOT      ")
    print("=" * 65)

    await start_dummy_health_server()
    asyncio.create_task(keep_alive_pinger())

    cfg = load_config()
    api_id = cfg.get("api_id")
    api_hash = cfg.get("api_hash")
    string_session = os.environ.get("STRING_SESSION") or cfg.get("string_session")

    if not api_id or not api_hash:
        print("[Error] Missing api_id or api_hash in config.json / environment")
        return

    if string_session:
        print("[*] Starting Telegram client with cloud StringSession...")
        client = TelegramClient(StringSession(string_session), api_id, api_hash)
    else:
        print(f"[*] Starting Telegram client with session file: {SESSION_FILE_PATH}...")
        client = TelegramClient(SESSION_FILE_PATH, api_id, api_hash)

    await client.start()

    me = await client.get_me()
    print(f"\n[OK] Logged in successfully as: {me.first_name} (@{me.username or me.id})")

    channels = cfg.get("channels", [])
    print(f"\n[+] Active Multi-Channel Routes ({len(channels)} configured):")
    for i, ch in enumerate(channels, 1):
        name = ch.get("name", f"Route {i}")
        status = "ACTIVE" if ch.get("enabled", True) else "PAUSED"
        print(f"  {i}. [{name}] {ch.get('source')} -> {ch.get('target')} [{status}]")

    # Map source peer_ids to target entities & track last seen message ID
    source_map = {}
    source_entities = []
    last_seen_msg_id = {}
    processed_albums = set()

    for ch in channels:
        if not ch.get("enabled", True):
            continue
        src = ch.get("source", "").strip()
        tgt = ch.get("target", "").strip()
        try:
            try:
                await client(JoinChannelRequest(src))
            except Exception:
                pass

            src_entity = await client.get_entity(src)
            src_peer_id = client.get_peer_id(src_entity)
            tgt_entity = await client.get_entity(tgt)

            # Initialize last_seen_msg_id with current latest message so we only forward new posts
            latest_msgs = await client.get_messages(src_entity, limit=1)
            latest_id = latest_msgs[0].id if latest_msgs else 0
            last_seen_msg_id[src_peer_id] = latest_id

            source_map[src_peer_id] = {
                "route": ch,
                "source_entity": src_entity,
                "target_entity": tgt_entity,
                "source_title": getattr(src_entity, 'title', src),
                "target_title": getattr(tgt_entity, 'title', tgt)
            }
            source_entities.append(src_entity)

            print(f"  [OK] Route Ready: {getattr(src_entity, 'title', src)} (Last ID: {latest_id}) -> {getattr(tgt_entity, 'title', tgt)}")
        except Exception as e:
            print(f"  [!] Error connecting route {src} -> {tgt}: {e}")

    print("\n" + "=" * 65)
    print(f"[*] ACTIVE: REAL-TIME EVENT LISTENER + 60s ANTI-SLEEP POLLER")
    print("=" * 65 + "\n")

    # 1. Real-time Instant Event Listener
    @client.on(events.NewMessage(chats=source_entities if source_entities else None))
    async def event_handler(event):
        try:
            chat_peer_id = event.chat_id
            route_info = source_map.get(chat_peer_id)
            if not route_info:
                return

            msg = event.message
            # Check if already processed by poller or earlier event
            if msg.id <= last_seen_msg_id.get(chat_peer_id, 0):
                return
            last_seen_msg_id[chat_peer_id] = max(last_seen_msg_id.get(chat_peer_id, 0), msg.id)

            route = route_info["route"]
            target_entity = route_info["target_entity"]
            src_title = route_info["source_title"]
            tgt_title = route_info["target_title"]

            if msg.grouped_id:
                if msg.grouped_id in processed_albums:
                    return
                processed_albums.add(msg.grouped_id)
                print(f"\n[📸 Real-Time Album Detected] From: {src_title}")
                await asyncio.sleep(2.5)
                # Update last_seen_msg_id for all parts of the album
                recent = await client.get_messages(route_info["source_entity"], limit=10)
                for r in recent:
                    if r.grouped_id == msg.grouped_id:
                        last_seen_msg_id[chat_peer_id] = max(last_seen_msg_id.get(chat_peer_id, 0), r.id)
                await forward_album(client, route_info["source_entity"], msg.grouped_id, route, target_entity, src_title, tgt_title)
            else:
                print(f"\n[📨 Real-Time Post Detected] From: {src_title} (ID: {msg.id})")
                await forward_single_message(client, msg, route, target_entity, src_title, tgt_title)

        except Exception as e:
            print(f"[Error in real-time handler]: {e}")

    # 2. Active Background Poller (Every 60 seconds) — Guarantees ZERO missed posts!
    async def active_poller():
        while True:
            await asyncio.sleep(60)
            for peer_id, info in source_map.items():
                try:
                    src_entity = info["source_entity"]
                    target_entity = info["target_entity"]
                    route = info["route"]
                    src_title = info["source_title"]
                    tgt_title = info["target_title"]
                    last_id = last_seen_msg_id.get(peer_id, 0)

                    # Fetch any messages newer than last_id
                    recent_msgs = await client.get_messages(src_entity, limit=5)
                    new_msgs = [m for m in reversed(recent_msgs) if m.id > last_id]

                    for m in new_msgs:
                        if m.id <= last_seen_msg_id.get(peer_id, 0):
                            continue
                        last_seen_msg_id[peer_id] = max(last_seen_msg_id.get(peer_id, 0), m.id)

                        if m.grouped_id:
                            if m.grouped_id in processed_albums:
                                continue
                            processed_albums.add(m.grouped_id)
                            print(f"\n[🔄 Poller Caught Album] From: {src_title}")
                            for rm in recent_msgs:
                                if rm.grouped_id == m.grouped_id:
                                    last_seen_msg_id[peer_id] = max(last_seen_msg_id.get(peer_id, 0), rm.id)
                            await forward_album(client, src_entity, m.grouped_id, route, target_entity, src_title, tgt_title)
                        else:
                            print(f"\n[🔄 Poller Caught Post] From: {src_title} (ID: {m.id})")
                            await forward_single_message(client, m, route, target_entity, src_title, tgt_title)
                except Exception as poll_err:
                    print(f"[Poller warning for {info['source_title']}]: {poll_err}")

    asyncio.create_task(active_poller())
    await client.run_until_disconnected()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] Userbot stopped by user.")
