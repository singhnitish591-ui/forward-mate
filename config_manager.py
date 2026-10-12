import json
import os
from typing import Dict, Any, List

CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")

DEFAULT_CONFIG: Dict[str, Any] = {
    "api_id": 26499464,
    "api_hash": "33517df0028944da2ac83bf97844cb86",
    "string_session": "",
    "channels": [
        {
            "name": "Quotes Route",
            "source": "@Quotes",
            "target": "@QuotientVibes",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["Join @Quotes", "t.me/Quotes"]
        },
        {
            "name": "Govt Naukri Route",
            "source": "@NotesHubX",
            "target": "@govt_naukari1",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["NotesHubX", "t.me/NotesHubX"]
        },
        {
            "name": "Crypto News Route",
            "source": "@Crypto_Ocean_CO",
            "target": "@crypto_market_newz",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["Crypto_Ocean_CO", "t.me/Crypto_Ocean_CO"]
        },
        {
            "name": "Trading PDF Book Route",
            "source": "@ProTradingTips1",
            "target": "@tradingpdfbook",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["ProTradingTips1", "t.me/ProTradingTips1"]
        },
        {
            "name": "Anime Route",
            "source": "@Anime_News4",
            "target": "@animeflix_watch",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["Anime_News4", "t.me/Anime_News4"]
        },
        {
            "name": "Movies Route",
            "source": "@iPapkorn",
            "target": "@sdmoviespointe",
            "enabled": True,
            "remove_links": True,
            "strip_signatures": True,
            "signatures": ["iPapkorn", "t.me/iPapkorn"]
        }
    ]
}

def load_config() -> Dict[str, Any]:
    # Check environment variables first (for cloud deployments)
    env_channels = os.environ.get("CHANNELS_JSON")
    if env_channels:
        try:
            channels = json.loads(env_channels)
            return {
                "api_id": int(os.environ.get("API_ID", DEFAULT_CONFIG["api_id"])),
                "api_hash": os.environ.get("API_HASH", DEFAULT_CONFIG["api_hash"]),
                "string_session": os.environ.get("STRING_SESSION", ""),
                "channels": channels
            }
        except Exception:
            pass

    if not os.path.exists(CONFIG_FILE):
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            cfg = json.load(f)
            # Ensure all default routes are populated if empty
            if not cfg.get("channels"):
                cfg["channels"] = DEFAULT_CONFIG["channels"]
                save_config(cfg)
            return cfg
    except Exception as e:
        print(f"[Error] Failed to load config.json: {e}")
        return DEFAULT_CONFIG

def save_config(cfg: Dict[str, Any]):
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)
