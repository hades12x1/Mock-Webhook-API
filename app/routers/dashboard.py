from fastapi import APIRouter, Request, Depends, Form, HTTPException
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse
from motor.motor_asyncio import AsyncIOMotorDatabase
from typing import Dict, Any, Optional
import json

from app.models import UserCreate, UserUpdate
from app.services.webhook import (
    create_user, update_user, check_username_available
)

router = APIRouter()

async def get_db(request: Request) -> AsyncIOMotorDatabase:
    return request.app.mongodb

@router.get("/", response_class=HTMLResponse)
async def dashboard(request: Request, db: AsyncIOMotorDatabase = Depends(get_db)):
    """
    Dashboard page for creating and configuring webhooks
    """
    # Get template
    templates = request.app.state.templates
    
    # Render template
    return templates.TemplateResponse(
        "dashboard.html",
        {"request": request, "domain": request.headers.get("host", "webhook-api.autobot.site")}
    )

@router.post("/api/users", response_model=Dict[str, Any])
async def create_user_api(
    request: Request,
    user: UserCreate,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Create a new user via API
    """
    try:
        # Create user
        user_data = await create_user(
            db=db,
            username=user.username,
            default_response=user.default_response,
            response_time_min=user.response_time_min,
            response_time_max=user.response_time_max
        )
        
        # Convert ObjectId to string for JSON serialization
        user_data["_id"] = str(user_data["_id"])
        
        return user_data
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.put("/api/users/{username}", response_model=Dict[str, Any])
async def update_user_api(
    username: str,
    user: UserUpdate,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Update user configuration via API
    """
    try:
        # Update user
        updated_user = await update_user(
            db=db,
            username=username,
            default_response=user.default_response,
            response_time_min=user.response_time_min,
            response_time_max=user.response_time_max
        )
        
        # Convert ObjectId to string for JSON serialization
        updated_user["_id"] = str(updated_user["_id"])
        
        return updated_user
    
    except HTTPException as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status_code)
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.get("/api/users/check/{username}", response_model=Dict[str, bool])
async def check_username(
    username: str,
    request: Request,
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Check if a username is available
    """
    try:
        # Check username
        available = await check_username_available(db, username)
        
        return {"available": available}
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)

@router.post("/create-webhook", response_class=RedirectResponse)
async def create_webhook_form(
    request: Request,
    username: str = Form(...),
    default_response: str = Form("{}"),
    response_time_min: int = Form(0),
    response_time_max: int = Form(1000),
    db: AsyncIOMotorDatabase = Depends(get_db)
):
    """
    Create a new webhook from form submission
    """
    try:
        # Parse default response
        try:
            response_json = json.loads(default_response)
        except:
            response_json = {"message": default_response}
        
        # Create user
        await create_user(
            db=db,
            username=username,
            default_response=response_json,
            response_time_min=response_time_min,
            response_time_max=response_time_max
        )
        
        # Redirect to viewer
        return RedirectResponse(url=f"/view/@{username}", status_code=303)
    
    except HTTPException as e:
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "dashboard.html",
            {
                "request": request,
                "error": e.detail,
                "username": username,
                "default_response": default_response,
                "response_time_min": response_time_min,
                "response_time_max": response_time_max,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=400
        )
    
    except Exception as e:
        # Get template
        templates = request.app.state.templates
        
        # Render template with error
        return templates.TemplateResponse(
            "dashboard.html",
            {
                "request": request,
                "error": str(e),
                "username": username,
                "default_response": default_response,
                "response_time_min": response_time_min,
                "response_time_max": response_time_max,
                "domain": request.headers.get("host", "webhook-api.autobot.site")
            },
            status_code=500
        )