import os
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv
from contextlib import asynccontextmanager
from datetime import datetime
import json

from app.routers import dashboard, webhook, viewer

# Load environment variables
load_dotenv()

# Database setup
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Connect to the MongoDB client when the application starts
    app.mongodb_client = AsyncIOMotorClient(os.getenv("MONGO_URI", "mongodb://mongodb:27017"))
    app.mongodb = app.mongodb_client[os.getenv("MONGO_DB", "webhook_db")]
    
    # Create indexes
    await app.mongodb["users"].create_index("username", unique=True)
    await app.mongodb["webhook_requests"].create_index("username")
    await app.mongodb["webhook_requests"].create_index("request_time")
    
    yield
    
    # Close MongoDB client when the application stops
    app.mongodb_client.close()

# Initialize FastAPI app
app = FastAPI(
    lifespan=lifespan, 
    title="Webhook Mock API", 
    description="API for creating and managing webhook mocks",
    version="2.0.0"
)

# Mount static files
app.mount("/static", StaticFiles(directory="app/static"), name="static")

# Setup Jinja2 templates
templates = Jinja2Templates(directory="app/templates")

# Add custom template globals and filters
templates.env.globals["current_year"] = datetime.now().year

# Add custom template filters
def tojson_filter(value, indent=None):
    """Convert Python object to JSON string"""
    return json.dumps(value, default=str, indent=indent)

templates.env.filters["tojson"] = tojson_filter

app.state.templates = templates

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(dashboard.router)
app.include_router(webhook.router)
app.include_router(viewer.router)

# Redirect root to dashboard
@app.get("/")
async def redirect_to_dashboard():
    return {"status": "ok", "message": "Webhook Mock API is running"}

# Entry point to run with uvicorn
if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)