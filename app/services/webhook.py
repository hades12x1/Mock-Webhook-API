import os
import json
import random
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional
import logging
import traceback

from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
import pandas as pd
from io import StringIO

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Configure logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

async def save_webhook_request(
    db: AsyncIOMotorDatabase,
    username: str,
    request: Request,
    response: Any,
    response_time: int
) -> str:
    """
    Save a webhook request to the database with enhanced logging
    """
    # Log detailed request information
    logger.debug(f"Saving request for username: {username}")
    logger.debug(f"Request method: {request.method}")
    logger.debug(f"Request path: {request.url.path}")
    logger.debug(f"Request headers: {dict(request.headers)}")
    
    # Get request body with more detailed logging
    body = None
    try:
        # Read the body
        raw_body = await request.body()
        logger.debug(f"Raw body bytes: {raw_body}")
        
        if raw_body:
            # Try to decode and parse
            try:
                body_str = raw_body.decode('utf-8')
                logger.debug(f"Decoded body string: {body_str}")
                
                # Attempt to parse as JSON
                try:
                    body = json.loads(body_str)
                    logger.debug(f"Parsed JSON body: {body}")
                except json.JSONDecodeError:
                    # If not JSON, store as string
                    body = body_str
                    logger.debug("Body is not valid JSON, storing as string")
            except Exception as decode_error:
                logger.error(f"Error decoding body: {decode_error}")
                body = raw_body
    except Exception as e:
        logger.error(f"Error reading request body: {e}")
        body = None

    # Create request document
    request_doc = {
        "id": str(uuid.uuid4()),
        "username": username,
        "method": request.method,
        "headers": dict(request.headers),
        "path": str(request.url.path),
        "query_params": dict(request.query_params),
        "body": body,
        "response": response,
        "request_time": datetime.utcnow(),
        "response_time": response_time  # in milliseconds
    }
    
    # Log the full request document before saving
    logger.debug("Full request document to be saved:")
    logger.debug(json.dumps(request_doc, default=str, indent=2))
    
    # Check if user has reached the maximum number of requests
    count = await db.webhook_requests.count_documents({"username": username})
    max_requests = int(os.getenv("MAX_REQUESTS_PER_USER", 100000))
    
    try:
        # Insert request document
        result = await db.webhook_requests.insert_one(request_doc)
        logger.debug(f"Request saved successfully. ID: {request_doc['id']}, MongoDB _id: {result.inserted_id}")
        
        return request_doc["id"]
    except Exception as insert_error:
        logger.error(f"Error inserting request document: {insert_error}")
        logger.error(traceback.format_exc())
        raise

async def get_user_config(db: AsyncIOMotorDatabase, username: str) -> Dict[str, Any]:
    """
    Get user configuration by username
    """
    user = await db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    return user

async def check_username_available(db: AsyncIOMotorDatabase, username: str) -> bool:
    """
    Check if a username is available
    """
    if not username or not username.isalnum():
        return False
        
    existing = await db.users.find_one({"username": username})
    return existing is None

async def create_user(db: AsyncIOMotorDatabase, username: str, default_response: Dict[str, Any],
                     response_time_min: int, response_time_max: int) -> Dict[str, Any]:
    """
    Create a new user
    """
    # Validate username
    if not username or not username.isalnum():
        raise HTTPException(status_code=400, detail="Username must be alphanumeric")
        
    # Check if username already exists
    if not await check_username_available(db, username):
        raise HTTPException(status_code=400, detail=f"Username '{username}' already exists")
    
    # Create user document
    user_doc = {
        "username": username,
        "created_at": datetime.utcnow(),
        "default_response": default_response,
        "response_time_min": response_time_min,
        "response_time_max": response_time_max
    }
    
    # Insert user document
    await db.users.insert_one(user_doc)
    return user_doc

async def update_user(db: AsyncIOMotorDatabase, username: str, 
                     default_response: Optional[Dict[str, Any]] = None,
                     response_time_min: Optional[int] = None, 
                     response_time_max: Optional[int] = None) -> Dict[str, Any]:
    """
    Update user configuration
    """
    # Get user
    user = await db.users.find_one({"username": username})
    if not user:
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    
    # Create update document
    update_doc = {}
    if default_response is not None:
        update_doc["default_response"] = default_response
    if response_time_min is not None:
        update_doc["response_time_min"] = response_time_min
    if response_time_max is not None:
        update_doc["response_time_max"] = response_time_max
    
    if update_doc:
        # Update user document
        await db.users.update_one(
            {"username": username},
            {"$set": update_doc}
        )
    
    # Get updated user
    updated_user = await db.users.find_one({"username": username})
    return updated_user

async def get_webhook_requests(db: AsyncIOMotorDatabase, username: str, 
                              limit: int = 100, skip: int = 0) -> List[Dict[str, Any]]:
    """
    Get webhook requests for a user
    """
    cursor = db.webhook_requests.find(
        {"username": username},
        sort=[("request_time", -1)]
    ).skip(skip).limit(limit)
    
    return await cursor.to_list(length=limit)

async def clear_webhook_requests(db: AsyncIOMotorDatabase, username: str) -> int:
    """
    Clear all webhook requests for a user
    """
    result = await db.webhook_requests.delete_many({"username": username})
    return result.deleted_count

async def export_webhook_requests_csv(db: AsyncIOMotorDatabase, username: str) -> str:
    """
    Export webhook requests to CSV
    """
    # Get all webhook requests for the user
    cursor = db.webhook_requests.find(
        {"username": username},
        sort=[("request_time", -1)]
    )
    
    requests = await cursor.to_list(length=None)
    
    if not requests:
        return "No requests found"
    
    # Convert to pandas DataFrame
    data = []
    for req in requests:
        # Format data for CSV
        row = {
            "id": req["id"],
            "method": req["method"],
            "path": req["path"],
            "request_time": req["request_time"].strftime("%Y-%m-%d %H:%M:%S"),
            "response_time_ms": req["response_time"],
            "headers": json.dumps(req["headers"]),
            "query_params": json.dumps(req["query_params"]),
            "body": json.dumps(req["body"]) if req["body"] else "",
            "response": json.dumps(req["response"]) if req["response"] else ""
        }
        data.append(row)
    
    df = pd.DataFrame(data)
    
    # Convert to CSV
    csv_buffer = StringIO()
    df.to_csv(csv_buffer, index=False)
    
    return csv_buffer.getvalue()

def simulate_processing_time(min_time: int, max_time: int) -> int:
    """
    Simulate processing time between min_time and max_time in milliseconds
    """
    process_time = random.randint(min_time, max_time)
    time.sleep(process_time / 1000)  # Convert to seconds
    return process_time