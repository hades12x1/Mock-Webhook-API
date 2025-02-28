#!/bin/bash

# Create necessary directories if they don't exist
mkdir -p app/routers
mkdir -p app/services
mkdir -p app/static/css
mkdir -p app/static/js
mkdir -p app/templates

# Create __init__.py files to ensure proper Python module structure
touch app/__init__.py
touch app/routers/__init__.py
touch app/services/__init__.py

# Ensure proper permissions on files
chmod -R 755 app/

echo "Directory structure created successfully!"
echo "Please make sure all your Python files are properly formatted with the correct router definitions."
echo "You can now run 'docker-compose up -d' to start the application."