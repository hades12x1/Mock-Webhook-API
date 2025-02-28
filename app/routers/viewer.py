from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List
from io import StringIO
import logging
import traceback

from app.services.webhook import (
    get_webhook_requests, get_user_config, clear_webhook_requests,
    export_webhook_requests_csv
)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

router = APIRouter()

async def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.mongodb

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
        # Get user
        user = await get_user_config(db, username)
        
        # Debug: Check initial request count
        request_count = await db.webhook_requests.count_documents({"username": username})
        logger.debug(f"Total requests for {username}: {request_count}")
        
        # Get template
        templates = request.app.state.templates
        
        # Render template with request count
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
                "error": str(e),
                "username": username,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=500
        )

@router.get("/api/requests/@{username}", response_model=List[Dict[str, Any]])
async def get_requests_api(
    username: str,
    request: Request,
    limit: int = 100,
    skip: int = 0,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Get webhook requests via API with enhanced error handling
    """
    try:
        # Get user to ensure they exist
        user = await get_user_config(db, username)
        logger.debug(f"Fetching requests for user: {username}")
        
        # Get requests with logging
        requests = await get_webhook_requests(db, username, limit, skip)
        logger.debug(f"Found {len(requests)} requests")
        
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
            
            # Handle body and response
            serialized_req['body'] = req.get('body', None)
            serialized_req['response'] = req.get('response', None)
            
            # Add response time
            serialized_req['response_time'] = req.get('response_time', 0)
            
            # Add headers and query params if needed
            serialized_req['headers'] = req.get('headers', {})
            serialized_req['query_params'] = req.get('query_params', {})
            
            serialized_requests.append(serialized_req)
        
        # Debug log of serialized requests
        logger.debug("Serialized requests:")
        for req in serialized_requests:
            logger.debug(f"Request: {req}")
        
        return serialized_requests
    
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
        # Get user
        await get_user_config(db, username)
        
        # Clear requests
        deleted_count = await clear_webhook_requests(db, username)
        
        return {"deleted_count": deleted_count}
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        logger.error(f"Error clearing requests: {e}")
        logger.error(traceback.format_exc())
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.get("/api/requests/@{username}/export", response_class=StreamingResponse)
async def export_requests_api(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Export webhook requests to CSV via API
    """
    try:
        # Get user
        await get_user_config(db, username)
        
        # Export requests to CSV
        csv_content = await export_webhook_requests_csv(db, username)
        
        # Create stream
        csv_stream = StringIO(csv_content)
        
        # Return streaming response
        return StreamingResponse(
            iter([csv_stream.getvalue()]),
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