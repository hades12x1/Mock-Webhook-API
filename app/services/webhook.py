import os
import json
import random
import time
import uuid
from datetime import datetime
from typing import Dict, Any, List, Optional, Union, Tuple
import logging
import traceback

from fastapi import HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase
from io import StringIO
import csv

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def simulate_processing_time(min_time: int, max_time: int) -> int:
    """
    Simulate processing time between min_time and max_time in milliseconds
    
    Args:
        min_time: Minimum response time in milliseconds
        max_time: Maximum response time in milliseconds
        
    Returns:
        int: Simulated processing time
    """
    # Ensure valid range
    if min_time < 0:
        min_time = 0
    if max_time < min_time:
        max_time = min_time
    
    # Generate random time in range
    process_time = random.randint(min_time, max_time)
    
    # Sleep for that duration (convert to seconds)
    time.sleep(process_time / 1000)
    
    return process_time

async def save_webhook_request(
    db: AsyncIOMotorDatabase,
    username: str,
    request: Request,
    response: Any,
    response_time: int
) -> str:
    """
    Save a webhook request to the database with enhanced logging
    
    Args:
        db: MongoDB database connection
        username: Username to save request for
        request: FastAPI request object
        response: Response data returned to client
        response_time: Processing time in milliseconds
        
    Returns:
        str: Request ID
    """
    # Log request information
    logger.info(f"Saving {request.method} request for username: {username}")
    
    # Get request body
    body = None
    try:
        # Read the body
        raw_body = await request.body()
        
        if raw_body:
            # Try to decode and parse as JSON
            try:
                body_str = raw_body.decode('utf-8')
                
                # Attempt to parse as JSON
                try:
                    body = json.loads(body_str)
                except json.JSONDecodeError:
                    # If not JSON, store as string
                    body = body_str
            except Exception as decode_error:
                logger.error(f"Error decoding body: {decode_error}")
                body = str(raw_body)  # Store as string representation
    except Exception as e:
        logger.error(f"Error reading request body: {e}")
        body = None

    # Create request document with unique id
    request_id = str(uuid.uuid4())
    request_doc = {
        "id": request_id,
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
    
    # Check if user has reached the maximum number of requests
    count = await db.webhook_requests.count_documents({"username": username})
    max_requests = int(os.getenv("MAX_REQUESTS_PER_USER", 100000))
    
    if count >= max_requests:
        # Delete the oldest requests to stay under the limit
        logger.warning(f"User {username} has reached the maximum of {max_requests} requests. Deleting oldest.")
        oldest_requests = await db.webhook_requests.find(
            {"username": username},
            sort=[("request_time", 1)]
        ).limit(1).to_list(length=1)
        
        if oldest_requests:
            await db.webhook_requests.delete_one({"_id": oldest_requests[0]["_id"]})
    
    try:
        # Insert request document
        result = await db.webhook_requests.insert_one(request_doc)
        logger.info(f"Request saved with ID: {request_id}")
        
        return request_id
    except Exception as insert_error:
        logger.error(f"Error inserting request document: {insert_error}")
        logger.error(traceback.format_exc())
        raise

async def get_user_config(db: AsyncIOMotorDatabase, username: str) -> Dict[str, Any]:
    """
    Get user configuration by username
    
    Args:
        db: MongoDB database connection
        username: Username to look up
        
    Returns:
        Dict: User configuration
        
    Raises:
        HTTPException: If user not found
    """
    user = await db.users.find_one({"username": username})
    if not user:
        logger.warning(f"User not found: {username}")
        raise HTTPException(status_code=404, detail=f"User '{username}' not found")
    return user

async def check_username_available(db: AsyncIOMotorDatabase, username: str) -> bool:
    """
    Check if a username is available
    
    Args:
        db: MongoDB database connection
        username: Username to check
        
    Returns:
        bool: True if available, False otherwise
    """
    if not username or not username.isalnum():
        return False
        
    existing = await db.users.find_one({"username": username})
    return existing is None

async def create_user(
    db: AsyncIOMotorDatabase, 
    username: str, 
    default_response: Dict[str, Any],
    response_time_min: int, 
    response_time_max: int
) -> Dict[str, Any]:
    """
    Create a new user
    
    Args:
        db: MongoDB database connection
        username: Username to create
        default_response: Default response to return
        response_time_min: Minimum response time in milliseconds
        response_time_max: Maximum response time in milliseconds
        
    Returns:
        Dict: Created user document
        
    Raises:
        HTTPException: If username invalid or already exists
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
    
    logger.info(f"Creating new user: {username}")
    
    # Insert user document
    await db.users.insert_one(user_doc)
    return user_doc

async def update_user(
    db: AsyncIOMotorDatabase, 
    username: str, 
    default_response: Optional[Dict[str, Any]] = None,
    response_time_min: Optional[int] = None, 
    response_time_max: Optional[int] = None
) -> Dict[str, Any]:
    """
    Update user configuration
    
    Args:
        db: MongoDB database connection
        username: Username to update
        default_response: New default response
        response_time_min: New minimum response time
        response_time_max: New maximum response time
        
    Returns:
        Dict: Updated user document
        
    Raises:
        HTTPException: If user not found
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
        logger.info(f"Updating user: {username}")
        # Update user document
        await db.users.update_one(
            {"username": username},
            {"$set": update_doc}
        )
    
    # Get updated user
    updated_user = await db.users.find_one({"username": username})
    return updated_user

async def get_webhook_requests_count(db: AsyncIOMotorDatabase, username: str) -> int:
    """
    Get the total count of webhook requests for a user
    
    Args:
        db: MongoDB database connection
        username: Username to get count for
        
    Returns:
        int: Total number of requests
    """
    count = await db.webhook_requests.count_documents({"username": username})
    return count

async def get_webhook_requests(
    db: AsyncIOMotorDatabase, 
    username: str, 
    limit: int = 10, 
    skip: int = 0
) -> List[Dict[str, Any]]:
    """
    Get webhook requests for a user with pagination
    
    Args:
        db: MongoDB database connection
        username: Username to get requests for
        limit: Maximum number of requests to return
        skip: Number of requests to skip (for pagination)
        
    Returns:
        List[Dict]: List of request documents
    """
    cursor = db.webhook_requests.find(
        {"username": username},
        sort=[("request_time", -1)]  # Sort by newest first
    ).skip(skip).limit(limit)
    
    return await cursor.to_list(length=limit)

async def delete_webhook_request(
    db: AsyncIOMotorDatabase, 
    username: str, 
    request_id: str
) -> bool:
    """
    Delete a specific webhook request by ID
    
    Args:
        db: MongoDB database connection
        username: Username the request belongs to
        request_id: ID of the request to delete
        
    Returns:
        bool: True if deleted, False if not found
    """
    # Delete the request
    result = await db.webhook_requests.delete_one(
        {"username": username, "id": request_id}
    )
    
    # Return success indicator
    return result.deleted_count > 0

async def clear_webhook_requests(db: AsyncIOMotorDatabase, username: str) -> int:
    """
    Clear all webhook requests for a user
    
    Args:
        db: MongoDB database connection
        username: Username to clear requests for
        
    Returns:
        int: Number of deleted requests
    """
    result = await db.webhook_requests.delete_many({"username": username})
    return result.deleted_count

async def export_webhook_requests_csv(db: AsyncIOMotorDatabase, username: str) -> str:
    """
    Export webhook requests to CSV
    
    Args:
        db: MongoDB database connection
        username: Username to export requests for
        
    Returns:
        str: CSV content
    """
    # Get all webhook requests for the user (limit to most recent 10,000)
    cursor = db.webhook_requests.find(
        {"username": username},
        sort=[("request_time", -1)]
    ).limit(10000)
    
    requests = await cursor.to_list(length=10000)
    
    if not requests:
        return "No requests found"
    
    # Create CSV content
    output = StringIO()
    csv_writer = csv.writer(output)
    
    # Define CSV header
    csv_writer.writerow([
        "ID", "Method", "Path", "Request Time", "Response Time (ms)",
        "Headers", "Query Parameters", "Request Body", "Response"
    ])
    
    # Write request data
    for req in requests:
        # Format request time
        request_time = req.get("request_time", datetime.utcnow()).strftime("%Y-%m-%d %H:%M:%S")
        
        # Format headers and query params as JSON strings
        headers_json = json.dumps(req.get("headers", {}))
        query_params_json = json.dumps(req.get("query_params", {}))
        
        # Format body and response
        body = req.get("body", None)
        body_json = json.dumps(body) if body is not None else ""
        
        response = req.get("response", None)
        response_json = json.dumps(response) if response is not None else ""
        
        # Write the row
        csv_writer.writerow([
            req.get("id", ""),
            req.get("method", ""),
            req.get("path", ""),
            request_time,
            req.get("response_time", 0),
            headers_json,
            query_params_json,
            body_json,
            response_json
        ])
    
    return output.getvalue()

async def search_webhook_requests(
    db: AsyncIOMotorDatabase,
    username: str,
    query: str,
    limit: int = 10
) -> List[Dict[str, Any]]:
    """
    Search webhook requests by method, path, or content
    
    Args:
        db: MongoDB database connection
        username: Username to search requests for
        query: Search query string
        limit: Maximum number of results to return
        
    Returns:
        List[Dict]: List of matching request documents
    """
    # Create search criteria
    search_criteria = {
        "$and": [
            {"username": username},
            {"$or": [
                {"method": {"$regex": query, "$options": "i"}},
                {"path": {"$regex": query, "$options": "i"}},
                # Use $toString to convert ObjectId to string for regex search
                {"id": {"$regex": query, "$options": "i"}}
            ]}
        ]
    }
    
    # Execute search
    cursor = db.webhook_requests.find(
        search_criteria,
        sort=[("request_time", -1)]
    ).limit(limit)
    
    return await cursor.to_list(length=limit)

async def get_request_statistics(
    db: AsyncIOMotorDatabase,
    username: str
) -> Dict[str, Any]:
    """
    Get statistics about webhook requests
    
    Args:
        db: MongoDB database connection
        username: Username to get statistics for
        
    Returns:
        Dict: Statistics about webhook requests
    """
    # Get total request count
    total_count = await db.webhook_requests.count_documents({"username": username})
    
    # Get method counts using aggregation
    method_counts = []
    if total_count > 0:
        method_counts_cursor = db.webhook_requests.aggregate([
            {"$match": {"username": username}},
            {"$group": {"_id": "$method", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ])
        method_counts = await method_counts_cursor.to_list(length=10)
    
    # Get average response time
    avg_response_time = 0
    if total_count > 0:
        avg_time_cursor = db.webhook_requests.aggregate([
            {"$match": {"username": username}},
            {"$group": {"_id": None, "avg_time": {"$avg": "$response_time"}}}
        ])
        avg_time_results = await avg_time_cursor.to_list(length=1)
        if avg_time_results:
            avg_response_time = round(avg_time_results[0]["avg_time"], 2)
    
    # Get latest request time
    latest_request = None
    if total_count > 0:
        latest = await db.webhook_requests.find_one(
            {"username": username},
            sort=[("request_time", -1)]
        )
        if latest:
            latest_request = latest.get("request_time")
    
    # Return statistics
    return {
        "total_requests": total_count,
        "method_counts": {item["_id"]: item["count"] for item in method_counts},
        "average_response_time": avg_response_time,
        "latest_request_time": latest_request.isoformat() if latest_request else None
    }