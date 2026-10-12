import asyncio
import os
import sys
from aiohttp import web
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.functions.channels import JoinChannelRequest
from cleaner import clean_content
from config_manager import load_config, save_config

# Path to local session storage
SESSION_FILE_PATH = os.path.join(os.path.dirname(__file__), "forwardmate_user")

# Dummy health check server to satisfy Render Free Web Service
async def start_dummy_health_server():
    port = int(os.environ.get("PORT", 8080))
    app = web.Application()
    async def health(request):
        return web.Response(text="Forward Mate Bot is Running 24/7!")
    app.router.add_get("/", health)
    app.router.add_get("/health", health)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    print(f"[*] Health server listening on 0.0.0.0:{port}")

async def main():
    print("=" * 65)
    print("      [*] FORWARD MATE -- MULTI-CHANNEL 24/7 USERBOT       ")
    print("=" * 65)

    # Start dummy health server for Render
    await start_dummy_health_server()

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

    # Map source peer_ids to target entities & route configs
    source_map = {}
    source_entities = []

    for ch in channels:
        src = ch.get("source", "").strip()
        tgt = ch.get("target", "").strip()
        try:
            # Auto-join source channel to receive live server events
            try:
                await client(JoinChannelRequest(src))
            except Exception:
                pass

            src_entity = await client.get_entity(src)
            src_peer_id = client.get_peer_id(src_entity)
            tgt_entity = await client.get_entity(tgt)

            source_map[src_peer_id] = {
                "route": ch,
                "target_entity": tgt_entity,
                "source_title": getattr(src_entity, 'title', src),
                "target_title": getattr(tgt_entity, 'title', tgt)
            }
            source_entities.append(src_entity)

            print(f"  [OK] Connected & Joined: {getattr(src_entity, 'title', src)} -> {getattr(tgt_entity, 'title', tgt)}")
        except Exception as e:
            print(f"  [!] Error connecting route {src} -> {tgt}: {e}")

    print("\n" + "=" * 65)
    print(f"[*] LISTENING 24/7 TO {len(source_map)} ACTIVE SOURCE CHANNELS...")
    print("    - Full Album/Multi-Photo & Single Media Support.")
    print("    - Promotional links & tags cleaned.")
    print("    - Published directly without forward tag.")
    print("=" * 65 + "\n")

    # Album buffer to collect multi-photo/video posts together
    processed_albums = set()

    @client.on(events.NewMessage(chats=source_entities if source_entities else None))
    async def handler(event):
        try:
            chat_peer_id = event.chat_id
            route_info = source_map.get(chat_peer_id)

            if not route_info and event.chat:
                chat_username = f"@{event.chat.username}" if getattr(event.chat, 'username', None) else ""
                for pid, info in source_map.items():
                    r_src = info["route"].get("source", "").lower()
                    if chat_username and r_src == chat_username.lower():
                        route_info = info
                        break

            if not route_info:
                return

            route = route_info["route"]
            target_entity = route_info["target_entity"]
            src_title = route_info["source_title"]
            tgt_title = route_info["target_title"]

            # Handle Grouped/Album Posts (like multi-photo collages in iPapkorn)
            if event.grouped_id:
                if event.grouped_id in processed_albums:
                    return
                processed_albums.add(event.grouped_id)

                # Keep set bounded
                if len(processed_albums) > 1000:
                    processed_albums.clear()

                print(f"\n[📸 New Album Post Detected] From: {src_title}")
                # Wait briefly for all parts of the album to arrive
                await asyncio.sleep(2.0)

                # Fetch all messages belonging to this album
                recent_msgs = await client.get_messages(event.chat, limit=15)
                album_items = [m for m in recent_msgs if m.grouped_id == event.grouped_id]

                if not album_items:
                    album_items = [event.message]

                # Extract caption from whichever message in the album carries it
                raw_caption = ""
                for m in album_items:
                    if m.message:
                        raw_caption = m.message
                        break

                cleaned_caption, _ = clean_content(
                    text=raw_caption,
                    remove_links=route.get("remove_links", True),
                    strip_signatures=route.get("strip_signatures", True),
                    signatures=route.get("signatures", [])
                )

                # Send all media files as a single album in chronological order
                album_files = [m.media for m in reversed(album_items) if m.media]

                try:
                    await client.send_file(
                        entity=target_entity,
                        file=album_files,
                        caption=cleaned_caption if cleaned_caption else None
                    )
                    print(f"  [✅ Successfully Published Album] {len(album_files)} items to: {tgt_title}")
                except Exception as album_err:
                    print(f"  [❌ Failed Album Delivery to {tgt_title}]: {album_err}")
                return

            # Handle Normal Single Message / Media Post
            print(f"\n[📨 New Post Detected] From: {src_title}")

            original_text = event.message.message or ""
            cleaned_text, meaningful = clean_content(
                text=original_text,
                remove_links=route.get("remove_links", True),
                strip_signatures=route.get("strip_signatures", True),
                signatures=route.get("signatures", [])
            )

            has_media = bool(event.message.media)
            if not has_media and not meaningful:
                print(f"  [⏩ Skipped] Post contained only promo links or signatures.")
                return

            try:
                if has_media:
                    await client.send_file(
                        entity=target_entity,
                        file=event.message.media,
                        caption=cleaned_text if meaningful else None
                    )
                else:
                    await client.send_message(
                        entity=target_entity,
                        message=cleaned_text
                    )

                print(f"  [✅ Successfully Published] Cleaned & sent to: {tgt_title}")
            except Exception as send_err:
                print(f"  [❌ Delivery Failed to {tgt_title}]: {send_err}")

        except Exception as e:
            print(f"[Error in event handler]: {e}")

    await client.run_until_disconnected()

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[!] Userbot stopped by user.")
