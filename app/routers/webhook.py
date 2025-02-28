import os
import json
from fastapi import APIRouter, Request, Response, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List

from app.services.webhook import get_user_config, save_webhook_request, simulate_processing_time

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
                        "request_id": request_id
                    }))
                except:
                    pass
        
        # Return response
        return JSONResponse(content=response_data)
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.websocket("/ws/@{username}")
async def websocket_endpoint(websocket: WebSocket, username: str, db: AsyncIOMotorDatabase = Depends(get_db)):
    """
    Websocket endpoint for realtime updates of webhook requests
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
        
        # Send initial welcome message
        await websocket.send_text(json.dumps({
            "event": "connected",
            "username": username
        }))
        
        # Keep the connection open and handle messages
        while True:
            data = await websocket.receive_text()
            # Process incoming messages if needed
            
    except HTTPException:
        # User not found
        await websocket.close(code=1008, reason="User not found")
        
    except WebSocketDisconnect:
        # Connection closed
        if username in active_connections and websocket in active_connections[username]:
            active_connections[username].remove(websocket)
            if not active_connections[username]:
                del active_connections[username]
    
    except Exception as e:
        # Other errors
        try:
            await websocket.close(code=1011, reason=str(e))
        except:
            pass
        
        if username in active_connections and websocket in active_connections[username]:
            active_connections[username].remove(websocket)
            if not active_connections[username]:
                del active_connections[username]