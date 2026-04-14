#!/usr/bin/env python3
"""
Simple script to keep the backend alive by pinging it periodically.
Run this on a server or use a cron job to ping every 10-14 minutes.
"""

import requests
import time
import logging
from datetime import datetime

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')
logger = logging.getLogger(__name__)

# Backend URL - update this to your deployed backend URL
BACKEND_URL = "https://your-backend-name.onrender.com"  # Update after deployment
PING_INTERVAL = 840  # 14 minutes (before 15-minute sleep)

def ping_backend():
    """Ping the backend to keep it alive"""
    try:
        response = requests.get(f"{BACKEND_URL}/", timeout=30)
        if response.status_code == 200:
            logger.info(f"✅ Backend is alive - Status: {response.status_code}")
            return True
        else:
            logger.warning(f"⚠️ Backend responded with status: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        logger.error(f"❌ Failed to ping backend: {e}")
        return False

def main():
    """Main loop to keep pinging the backend"""
    logger.info(f"🚀 Starting backend keep-alive service for {BACKEND_URL}")
    logger.info(f"📡 Pinging every {PING_INTERVAL} seconds ({PING_INTERVAL/60} minutes)")
    
    while True:
        try:
            ping_backend()
            time.sleep(PING_INTERVAL)
        except KeyboardInterrupt:
            logger.info("🛑 Keep-alive service stopped by user")
            break
        except Exception as e:
            logger.error(f"💥 Unexpected error: {e}")
            time.sleep(60)  # Wait 1 minute before retrying

if __name__ == "__main__":
    main()