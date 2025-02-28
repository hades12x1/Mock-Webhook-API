from fastapi import APIRouter, Request, Depends, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, List, Optional
import json
from io import StringIO

from app.services.webhook import (
    get_webhook_requests, get_user_config, clear_webhook_requests,
    export_webhook_requests_csv
)

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
        
        # Get template
        templates = request.app.state.templates
        
        # Render template
        return templates.TemplateResponse(
            "viewer.html",
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
    Get webhook requests via API
    """
    try:
        # Get user
        await get_user_config(db, username)
        
        # Get requests
        requests = await get_webhook_requests(db, username, limit, skip)
        
        # Convert ObjectId to string for JSON serialization
        for req in requests:
            req["_id"] = str(req["_id"])
            req["request_time"] = req["request_time"].isoformat()
        
        return requests
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
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
        # Get user
        await get_user_config(db, username)
        
        # Clear requests
        deleted_count = await clear_webhook_requests(db, username)
        
        return {"deleted_count": deleted_count}
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
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
        return JSONResponse(content={"error": str(e)}, status_code=500)