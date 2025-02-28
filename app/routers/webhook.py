import os
import json
from fastapi import APIRouter, Request, Response, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List
import logging
import traceback

from app.services.webhook import get_user_config, save_webhook_request, simulate_processing_time

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Define the router explicitly
router = APIRouter()

# Keep track of active websocket connections for realtime updates
active_connections: Dict[str, List[WebSocket]] = {}

async def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.mongodb

@router.api_route("/api/@{username}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], 
                 response_class=Response)
async def webhook_endpoint(username: str, request: Request, db: AsyncIOMotorDatabase = Depends(get_db)):
    """
    Handle incoming webhook requests for a specific username
    """
    try:
        # Log incoming request details
        logger.debug(f"Received {request.method} request for username: {username}")
        logger.debug(f"Request headers: {dict(request.headers)}")
        
        # Try to read request body
        try:
            body = await request.body()
            logger.debug(f"Request body: {body}")
        except Exception as body_error:
            logger.error(f"Error reading request body: {body_error}")
            body = None
        
        # Get user configuration
        user = await get_user_config(db, username)
        
        # Simulate processing time
        process_time = simulate_processing_time(
            user.get("response_time_min", 0),
            user.get("response_time_max", 1000)
        )
        
        # Get default response
        response_data = user.get("default_response", {"status": "success"})
        
        # Save request to database
        request_id = await save_webhook_request(
            db=db,
            username=username,
            request=request,
            response=response_data,
            response_time=process_time
        )
        
        # Send notification to websocket clients
        if username in active_connections:
            for connection in active_connections[username]:
                try:
                    await connection.send_text(json.dumps({
                        "event": "new_request",
                        "request_id": request_id,
                        "method": request.method
                    }))
                except Exception as ws_error:
                    logger.error(f"Error sending websocket message: {ws_error}")
        
        # Return response
        return JSONResponse(content=response_data)
    
    except HTTPException as e:
        logger.error(f"HTTP Exception: {e.detail}")
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Unexpected error in webhook endpoint: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.websocket("/ws/@{username}")
async def websocket_endpoint(websocket: WebSocket, username: str, db: AsyncIOMotorDatabase = Depends(get_db)):
    """
    Websocket endpoint for realtime updates of webhook requests
    """
    try:
        # Log websocket connection attempt
        logger.debug(f"Websocket connection attempt for username: {username}")
        
        # Accept the websocket connection
        await websocket.accept()
        
        # Check if user exists
        user = await get_user_config(db, username)
        
        # Add connection to active connections
        if username not in active_connections:
            active_connections[username] = []
        active_connections[username].append(websocket)
        
        # Log successful connection
        logger.debug(f"Websocket connected for username: {username}")
        
        # Send initial welcome message
        await websocket.send_text(json.dumps({
            "event": "connected",
            "username": username
        }))
        
        # Keep the connection open and handle messages
        while True:
            try:
                _ = await websocket.receive_text()
                # Can add message processing logic here if needed
            except WebSocketDisconnect:
                logger.debug(f"Websocket disconnected for username: {username}")
                break
    
    except HTTPException as http_err:
        # User not found
        logger.error(f"Websocket connection failed - User not found: {http_err}")
        await websocket.close(code=1008, reason="User not found")
        
    except WebSocketDisconnect:
        # Connection closed
        logger.debug(f"Websocket disconnected for username: {username}")
        if username in active_connections and websocket in active_connections[username]:
            active_connections[username].remove(websocket)
            if not active_connections[username]:
                del active_connections[username]
    
    except Exception as e:
        # Other errors
        logger.error(f"Websocket error for username {username}: {e}")
        logger.error(traceback.format_exc())
        
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
        
        if username in active_connections and websocket in active_connections[username]:
            active_connections[username].remove(websocket)
            if not active_connections[username]:
                del active_connections[username]