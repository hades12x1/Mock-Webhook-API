from fastapi import APIRouter, Request, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List, Optional
from io import StringIO
import csv
import json
import logging
import traceback
from datetime import datetime
import asyncio

from app.services.webhook import (
    get_webhook_requests, get_user_config, clear_webhook_requests,
    export_webhook_requests_csv, delete_webhook_request, get_webhook_requests_count
)
from app.services.db import get_db, get_db_websocket

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

# Dictionary to store active WebSocket connections
active_connections: Dict[str, List[WebSocket]] = {}

@router.get("/view/@{username}", response_class=HTMLResponse)
async def view_requests(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    View webhook requests for a specific username
    """
    try:
        # Validate username
        if not username or not username.isalnum():
            # Get template
            templates = request.app.state.templates
            
            # Render template with error
            return templates.TemplateResponse(
                "viewer.html",
                {
                    "request": request,
                    "error": "Invalid username format. Username must be alphanumeric.",
                    "domain": request.headers.get("host", "webhook-api.autobot.site")
                },
                status_code=400
            )
        
        # Get user information
        user = await get_user_config(db, username)
        
        # Get the count of requests for this user
        request_count = await db.webhook_requests.count_documents({"username": username})
        logger.info(f"Total requests for {username}: {request_count}")
        
        # Get template
        templates = request.app.state.templates
        
        # Render template with request count and user information
        return templates.TemplateResponse(
            "viewer.html",
            {
                "request": request,
                "username": username,
                "user": user,
                "request_count": request_count,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            }
        )
    
    except HTTPException as e:
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "viewer.html",
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
        logger.error(f"Error in view_requests: {e}")
        logger.error(traceback.format_exc())
        
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "viewer.html",
            {
                "request": request,
                "error": f"An unexpected error occurred: {str(e)}",
                "username": username,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=500
        )

@router.get("/api/requests/@{username}", response_model=List[Dict[str, Any]])
async def get_requests_api(
    username: str,
    request: Request,
    limit: int = 10,
    skip: int = 0,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Get webhook requests via API with enhanced error handling
    """
    try:
        # Validate limit and skip parameters
        if limit < 1 or limit > 100:
            limit = 10  # Default to 10 if invalid
        
        if skip < 0:
            skip = 0  # Default to 0 if negative
        
        # Get user to ensure they exist
        user = await get_user_config(db, username)
        logger.info(f"Fetching requests for user: {username}, limit: {limit}, skip: {skip}")
        
        # Get requests
        requests = await get_webhook_requests(db, username, limit, skip)
        logger.info(f"Found {len(requests)} requests for {username}")
        
        # Convert to JSON-serializable format
        serialized_requests = []
        for req in requests:
            # Create a copy to avoid modifying original
            serialized_req = {}
            
            # Convert specific fields
            serialized_req['id'] = req.get('id', '')
            serialized_req['username'] = req.get('username', '')
            serialized_req['method'] = req.get('method', '')
            serialized_req['path'] = req.get('path', '')
            
            # Handle datetime conversion
            if req.get('request_time'):
                serialized_req['request_time'] = req['request_time'].isoformat()
            else:
                serialized_req['request_time'] = datetime.utcnow().isoformat()
            
            # Handle body and response
            serialized_req['body'] = req.get('body', None)
            serialized_req['response'] = req.get('response', None)
            
            # Add response time
            serialized_req['response_time'] = req.get('response_time', 0)
            
            # Add headers and query params
            serialized_req['headers'] = req.get('headers', {})
            serialized_req['query_params'] = req.get('query_params', {})
            
            serialized_requests.append(serialized_req)
        
        return serialized_requests
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        # Log the full error details
        logger.error(f"Error in get_requests_api: {e}")
        logger.error(traceback.format_exc())
        
        return JSONResponse(
            content={
                "error": str(e), 
                "details": traceback.format_exc()
            }, 
            status_code=500
        )

@router.get("/api/requests/@{username}/count", response_model=Dict[str, int])
async def get_request_count_api(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Get the total number of webhook requests for a user
    """
    try:
        # Get user to ensure they exist
        await get_user_config(db, username)
        
        # Get count
        count = await get_webhook_requests_count(db, username)
        
        return {"count": count}
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Error getting request count: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.delete("/api/requests/@{username}", response_model=Dict[str, int])
async def clear_requests_api(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Clear all webhook requests for a user via API
    """
    try:
        # Get user to confirm existence
        await get_user_config(db, username)
        
        # Clear requests
        deleted_count = await clear_webhook_requests(db, username)
        logger.info(f"Cleared {deleted_count} requests for user {username}")
        
        return {"deleted_count": deleted_count}
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Error clearing requests: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.delete("/api/requests/@{username}/{request_id}", response_model=Dict[str, Any])
async def delete_request_api(
    username: str,
    request_id: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Delete a specific webhook request by ID
    """
    try:
        # Get user to confirm existence
        await get_user_config(db, username)
        
        # Delete request
        result = await delete_webhook_request(db, username, request_id)
        
        if result:
            return {"success": True, "message": "Request deleted successfully"}
        else:
            return JSONResponse(
                content={"success": False, "error": "Request not found"},
                status_code=404
            )
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Error deleting request: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.get("/api/requests/@{username}/export", response_class=StreamingResponse)
async def export_requests_api(
    username: str,
    request: Request,
    format: str = "csv",
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Export webhook requests to CSV or JSON via API
    """
    try:
        # Get user to confirm existence
        await get_user_config(db, username)
        
        if format.lower() == "json":
            # Export as JSON
            requests = await get_webhook_requests(db, username, limit=10000, skip=0)
            
            # Convert datetime objects to strings
            for req in requests:
                if 'request_time' in req:
                    req['request_time'] = req['request_time'].isoformat()
            
            # Create JSON content
            json_content = json.dumps(requests, indent=2)
            
            # Return streaming response
            return StreamingResponse(
                iter([json_content]),
                media_type="application/json",
                headers={
                    "Content-Disposition": f"attachment; filename={username}_webhook_requests.json"
                }
            )
        else:
            # Default to CSV export
            csv_content = await export_webhook_requests_csv(db, username)
            
            # Return streaming response
            return StreamingResponse(
                iter([csv_content]),
                media_type="text/csv",
                headers={
                    "Content-Disposition": f"attachment; filename={username}_webhook_requests.csv"
                }
            )
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Error exporting requests: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.websocket("/ws/viewer/@{username}")
async def viewer_websocket(
    websocket: WebSocket, 
    username: str, 
    db: AsyncIOMotorDatabase = Depends(get_db_websocket)
):
    """
    WebSocket endpoint for real-time updates of the viewer
    Uses polling mechanism instead of change streams
    """
    last_request_id = None
    
    try:
        await websocket.accept()
        
        # Check if user exists
        user = await get_user_config(db, username)
        
        # Register connection
        if username not in active_connections:
            active_connections[username] = []
        active_connections[username].append(websocket)
        
        logger.info(f"Viewer WebSocket connected for username: {username}")
        
        # Send initial count
        request_count = await db.webhook_requests.count_documents({"username": username})
        await websocket.send_text(json.dumps({
            "event": "connected",
            "username": username,
            "request_count": request_count
        }))
        
        # Keep connection alive and check for new requests
        while True:
            try:
                # Find the most recent request
                latest_request = await db.webhook_requests.find_one(
                    {"username": username},
                    sort=[("request_time", -1)]
                )
                
                # Check if there's a new request
                if latest_request and (
                    last_request_id is None or 
                    str(latest_request['_id']) != last_request_id
                ):
                    # Update last request ID
                    last_request_id = str(latest_request['_id'])
                    
                    # Send new request notification
                    await websocket.send_text(json.dumps({
                        "event": "new_request",
                        "method": latest_request.get('method', 'UNKNOWN'),
                        "request_id": last_request_id
                    }))
                
                # Wait for a short time before next check
                await asyncio.sleep(2)  # 2-second polling interval
                
                # Optional: Send a ping to keep connection alive
                await websocket.send_text(json.dumps({"event": "ping"}))
                
            except WebSocketDisconnect:
                logger.error(f"Error in WebSocket polling: {inner_error}")
                await asyncio.sleep(2)  # Prevent tight error loop.info(f"Viewer WebSocket disconnected for {username}")
                break
            except Exception as inner_error:
                logger.error(f"Error in WebSocket polling: {inner_error}")
                await asyncio.sleep(2)