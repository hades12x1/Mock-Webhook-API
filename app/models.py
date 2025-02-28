from datetime import datetime
from pydantic import BaseModel, Field
from typing import Dict, Any, Optional, List

class User(BaseModel):
    username: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    default_response: Dict[str, Any] = Field(default_factory=lambda: {"status": "success", "message": "Default response"})
    response_time_min: int = 0  # milliseconds
    response_time_max: int = 1000  # milliseconds
    
class WebhookRequest(BaseModel):
    id: str
    username: str
    method: str
    headers: Dict[str, str]
    path: str
    query_params: Dict[str, List[str]] = {}
    body: Optional[Any] = None
    response: Any
    request_time: datetime
    response_time: int  # Processing time in milliseconds
    
class UserCreate(BaseModel):
    username: str
    default_response: Dict[str, Any] = {"status": "success", "message": "Default response"}
    response_time_min: int = 0
    response_time_max: int = 1000
    
class UserUpdate(BaseModel):
    default_response: Optional[Dict[str, Any]] = None
    response_time_min: Optional[int] = None
    response_time_max: Optional[int] = None

class WebhookResponse(BaseModel):
    status_code: int = 200
    content: Dict[str, Any] = Field(default_factory=lambda: {"status": "success", "message": "Default response"})