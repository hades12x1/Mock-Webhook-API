from fastapi import Request, WebSocket
from motor.motor_asyncio import AsyncIOMotorDatabase
import logging

logger = logging.getLogger(__name__)

async def get_db(request: Request) -> AsyncIOMotorDatabase:
    """
    Get database connection from request app state
    
    Args:
        request: FastAPI request object
        
    Returns:
        AsyncIOMotorDatabase: MongoDB database connection
    """
    return request.app.mongodb

async def get_db_websocket(websocket: WebSocket) -> AsyncIOMotorDatabase:
    """
    Get database connection from websocket app state
    
    Args:
        websocket: FastAPI WebSocket connection
        
    Returns:
        AsyncIOMotorDatabase: MongoDB database connection
    """
    return websocket.app.mongodb