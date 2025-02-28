import os
from typing import Optional
from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPBasic, HTTPBasicCredentials
import secrets

security = HTTPBasic()

def get_current_username(credentials: HTTPBasicCredentials = Depends(security)):
    """
    Verify credentials for the dashboard
    Note: In a production app, you would use a more secure authentication method
    """
    correct_username = "admin"
    correct_password = os.getenv("ADMIN_PASSWORD", "admin")
    
    is_correct_username = secrets.compare_digest(credentials.username, correct_username)
    is_correct_password = secrets.compare_digest(credentials.password, correct_password)
    
    if not (is_correct_username and is_correct_password):
        raise HTTPException(
            status_code=401,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Basic"},
        )
    
    return credentials.username