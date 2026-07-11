import jwt
from datetime import datetime, timedelta
from django.conf import settings
from django.http import JsonResponse
from functools import wraps
from api.db import users_col, normalize_id

JWT_SECRET = getattr(settings, "JWT_SECRET", "super-secret-pharmacy-key-12345-long-key-for-sha256")
JWT_ALGORITHM = "HS256"

def generate_token(user_id, role):
    """Generates a JWT token for a given user ID and role."""
    payload = {
        "userId": str(user_id),
        "role": role,
        "exp": datetime.utcnow() + timedelta(days=1),  # Expires in 24 hours
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def decode_token(token):
    """Decodes a JWT token. Returns payload dict if valid, or None if expired/invalid."""
    try:
        if token.startswith("Bearer "):
            token = token.split(" ")[1]
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
        return None

def jwt_login_required(view_func):
    """Decorator to require valid JWT token authentication on API views."""
    @wraps(view_func)
    def _wrapped_view(request, *args, **kwargs):
        auth_header = request.headers.get("Authorization")
        token = None
        if auth_header:
            token = auth_header
        else:
            token = request.COOKIES.get("jwt_token") or request.session.get("jwt_token")

        if not token:
            return JsonResponse({"error": "Authentication required. Missing token."}, status=401)
        
        payload = decode_token(token)
        if not payload:
            return JsonResponse({"error": "Invalid or expired authentication token."}, status=401)
        
        # Fetch user details
        user = users_col.find_one({"_id": normalize_id(payload["userId"])})
        if not user:
            return JsonResponse({"error": "User account not found."}, status=401)
            
        # Check if user is blocked/inactive
        if user.get("isBlocked", False) or user.get("status") == "Blocked":
            return JsonResponse({"error": "Your account has been blocked by the Administrator."}, status=403)
            
        request.user = user
        return view_func(request, *args, **kwargs)
    return _wrapped_view

def jwt_admin_required(view_func):
    """Decorator to require that the authenticated user has the 'admin' role."""
    @wraps(view_func)
    @jwt_login_required
    def _wrapped_view(request, *args, **kwargs):
        if request.user.get("role") != "admin":
            return JsonResponse({"error": "Forbidden. Admin privileges required."}, status=403)
        return view_func(request, *args, **kwargs)
    return _wrapped_view
