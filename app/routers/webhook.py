import os
import json
from fastapi import APIRouter, Request, Response, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, HTMLResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List
import logging
import traceback

from app.services.webhook import get_user_config, save_webhook_request, simulate_processing_time
from app.services.db import get_db, get_db_websocket

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Define the router explicitly
router = APIRouter()

# Keep track of active websocket connections for realtime updates
active_connections: Dict[str, List[WebSocket]] = {}

@router.get("/webhook/@{username}", response_class=HTMLResponse)
async def webhook_tester(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Webhook tester page for sending test requests
    """
    try:
        # Get user information
        user = await get_user_config(db, username)
        
        # Get template
        templates = request.app.state.templates
        
        # Render template
        return templates.TemplateResponse(
            "webhook.html",
            {
                "request": request,
                "username": username,
                "user": user,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            }
        )
    
    except HTTPException as e:
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "webhook.html",
            {
                "request": request,
                "error": e.detail,
                "username": username,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=e.status_code
        )
    
    except Exception as e:
        # Detailed error logging
        logger.error(f"Error in webhook_tester: {e}")
        logger.error(traceback.format_exc())
        
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "webhook.html",
            {
                "request": request,
                "error": str(e),
                "username": username,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=500
        )

@router.api_route("/api/@{username}/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], 
                 response_class=Response)
async def webhook_endpoint_with_path(
    username: str, 
    path: str, 
    request: Request, 
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Handle incoming webhook requests with path parameters
    """
    return await handle_webhook_request(username, request, db)

@router.api_route("/api/@{username}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"], 
                 response_class=Response)
async def webhook_endpoint(
    username: str, 
    request: Request, 
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Handle incoming webhook requests for a specific username
    """
    return await handle_webhook_request(username, request, db)

async def handle_webhook_request(username: str, request: Request, db: AsyncIOMotorDatabase):
    """
    Common handler for webhook requests
    """
    try:
        # Log incoming request
        logger.info(f"Received {request.method} request for username: {username}")
        
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
async def websocket_endpoint(
    websocket: WebSocket, 
    username: str, 
    db: AsyncIOMotorDatabase = Depends(get_db_websocket)
):
    """
    Websocket endpoint for realtime updates of webhook requests
    Uses get_db_websocket dependency to fix the 'request' parameter issue
    """
    try:
        # Accept the websocket connection
        await websocket.accept()
        
        # Check if user exists
        user = await get_user_config(db, username)
        
        # Add connection to active connections
        if username not in active_connections:
            active_connections[username] = []
        active_connections[username].append(websocket)
        
        logger.info(f"Websocket connected for username: {username}")
        
        # Send initial welcome message
        await websocket.send_text(json.dumps({
            "event": "connected",
            "username": username,
            "message": "Connected to webhook updates"
        }))
        
        # Keep the connection open and handle messages
        while True:
            try:
                # Wait for messages (heartbeat or commands)
                message = await websocket.receive_text()
                
                # Parse the message
                try:
                    data = json.loads(message)
                    if data.get("type") == "ping":
                        await websocket.send_text(json.dumps({
                            "event": "pong",
                            "timestamp": data.get("timestamp", 0)
                        }))
                except:
                    # Ignore invalid messages
                    pass
                    
            except WebSocketDisconnect:
                logger.info(f"Websocket disconnected for username: {username}")
                break
    
    except HTTPException as http_err:
        # User not found
        logger.error(f"Websocket connection failed - User not found: {http_err}")
        try:
            await websocket.close(code=1008, reason="User not found")
        except:
            pass
        
    except WebSocketDisconnect:
        # Connection closed
        logger.info(f"Websocket disconnected for username: {username}")
        
    except Exception as e:
        # Other errors
        logger.error(f"Websocket error for username {username}: {e}")
        logger.error(traceback.format_exc())
        
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
        
    finally:
        # Clean up connection
        if username in active_connections and websocket in active_connections[username]:
            active_connections[username].remove(websocket)
            if not active_connections[username]:
                del active_connections[username]