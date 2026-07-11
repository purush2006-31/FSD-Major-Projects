import json
from datetime import datetime
from django.http import JsonResponse as DjangoJsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.contrib.auth.hashers import check_password, make_password
from api.db import users_col, categories_col, medicines_col, cart_col, orders_col, normalize_id, to_jsonable
from api.auth import generate_token, jwt_login_required, jwt_admin_required


def JsonResponse(data, safe=None, **kwargs):
    """Wrap Django JsonResponse so MongoDB ObjectId values are serialized safely."""
    if safe is None:
        safe = not isinstance(data, list)
    return DjangoJsonResponse(to_jsonable(data), safe=safe, **kwargs)

def get_json_body(request):
    """Safely parses JSON request body."""
    try:
        return json.loads(request.body.decode('utf-8'))
    except Exception:
        return {}

# =====================================================================
# AUTHENTICATION APIs
# =====================================================================

@csrf_exempt
def auth_register(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed. Use POST."}, status=405)
    
    body = get_json_body(request)
    name = body.get("name")
    email = body.get("email")
    phone = body.get("phone", "")
    password = body.get("password")
    address = body.get("address", "")
    role = body.get("role", "customer")  # Default is customer

    if not name or not email or not password:
        return JsonResponse({"error": "Name, email, and password are required fields."}, status=400)
    
    # Check if user already exists
    existing_user = users_col.find_one({"email": email})
    if existing_user:
        return JsonResponse({"error": "User with this email already registered."}, status=400)

    # Create user
    user_doc = {
        "name": name,
        "email": email,
        "phone": phone,
        "password": make_password(password),
        "address": address,
        "role": role,
        "isBlocked": False,
        "createdAt": datetime.utcnow().isoformat()
    }
    
    res = users_col.insert_one(user_doc)
    user_id = res.inserted_id

    # Generate token
    token = generate_token(user_id, role)

    # Return created user (omit password)
    return_user = {
        "_id": user_id,
        "name": name,
        "email": email,
        "phone": phone,
        "address": address,
        "role": role,
        "createdAt": user_doc["createdAt"]
    }

    response = JsonResponse({
        "message": "User registered successfully.",
        "user": return_user,
        "token": token
    }, status=201)
    
    # Set jwt token in cookie
    response.set_cookie("jwt_token", token, httponly=True, samesite="Lax")
    return response


@csrf_exempt
def auth_login(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed. Use POST."}, status=405)
    
    body = get_json_body(request)
    email = body.get("email")
    password = body.get("password")

    if not email or not password:
        return JsonResponse({"error": "Email and password are required."}, status=400)

    user = users_col.find_one({"email": email})
    if not user:
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    if user.get("isBlocked", False) or user.get("status") == "Blocked":
        return JsonResponse({"error": "This account is blocked by the administrator."}, status=403)

    if not check_password(password, user["password"]):
        return JsonResponse({"error": "Invalid email or password."}, status=401)

    # Generate token
    token = generate_token(user["_id"], user["role"])

    return_user = {
        "_id": user["_id"],
        "name": user["name"],
        "email": user["email"],
        "phone": user.get("phone", ""),
        "address": user.get("address", ""),
        "role": user["role"]
    }

    response = JsonResponse({
        "message": "Logged in successfully.",
        "user": return_user,
        "token": token
    })
    
    response.set_cookie("jwt_token", token, httponly=True, samesite="Lax")
    return response


@csrf_exempt
def auth_logout(request):
    response = JsonResponse({"message": "Logged out successfully."})
    response.delete_cookie("jwt_token")
    # Also clean session if active
    if hasattr(request, "session"):
        request.session.flush()
    return response


@csrf_exempt
@jwt_login_required
def user_profile(request):
    user = request.user
    if request.method == "GET":
        profile_data = {
            "_id": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "phone": user.get("phone", ""),
            "address": user.get("address", ""),
            "role": user["role"],
            "createdAt": user.get("createdAt", "")
        }
        return JsonResponse(profile_data)

    elif request.method == "PUT":
        body = get_json_body(request)
        name = body.get("name", user["name"])
        phone = body.get("phone", user.get("phone", ""))
        address = body.get("address", user.get("address", ""))
        new_password = body.get("password")

        update_fields = {
            "name": name,
            "phone": phone,
            "address": address
        }

        if new_password:
            update_fields["password"] = make_password(new_password)

        users_col.update_one({"_id": user["_id"]}, {"$set": update_fields})
        
        # Get updated document
        updated_user = users_col.find_one({"_id": user["_id"]})
        return JsonResponse({
            "message": "Profile updated successfully.",
            "user": {
                "_id": updated_user["_id"],
                "name": updated_user["name"],
                "email": updated_user["email"],
                "phone": updated_user.get("phone", ""),
                "address": updated_user.get("address", ""),
                "role": updated_user["role"]
            }
        })
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


# =====================================================================
# CATEGORY APIs
# =====================================================================

@csrf_exempt
def categories_list(request):
    if request.method == "GET":
        cats = list(categories_col.find({}))
        return JsonResponse(cats, safe=False)
        
    elif request.method == "POST":
        # Requires Admin
        @jwt_admin_required
        def _create(req):
            body = get_json_body(req)
            name = body.get("categoryName")
            description = body.get("description", "")
            if not name:
                return JsonResponse({"error": "Category name is required."}, status=400)
            
            # Check duplicate
            existing = categories_col.find_one({"categoryName": name})
            if existing:
                return JsonResponse({"error": "Category already exists."}, status=400)

            cat_doc = {
                "categoryName": name,
                "description": description
            }
            res = categories_col.insert_one(cat_doc)
            cat_doc["_id"] = res.inserted_id
            return JsonResponse(cat_doc, status=201)
        return _create(request)
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def category_detail(request, id):
    cat = categories_col.find_one({"_id": id})
    if not cat:
        return JsonResponse({"error": "Category not found."}, status=404)

    if request.method == "GET":
        return JsonResponse(cat)
        
    elif request.method == "PUT":
        @jwt_admin_required
        def _update(req):
            body = get_json_body(req)
            name = body.get("categoryName")
            description = body.get("description")
            
            update_data = {}
            if name is not None:
                update_data["categoryName"] = name
            if description is not None:
                update_data["description"] = description
                
            if update_data:
                categories_col.update_one({"_id": id}, {"$set": update_data})
                cat.update(update_data)
            return JsonResponse(cat)
        return _update(request)
        
    elif request.method == "DELETE":
        @jwt_admin_required
        def _delete(req):
            categories_col.delete_one({"_id": id})
            return JsonResponse({"message": "Category deleted successfully."})
        return _delete(request)
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


# =====================================================================
# MEDICINE APIs
# =====================================================================

@csrf_exempt
def medicines_list(request):
    if request.method == "GET":
        # Search & filters
        q = request.GET.get("q")
        category = request.GET.get("category")
        min_price = request.GET.get("minPrice")
        max_price = request.GET.get("maxPrice")
        sort_by = request.GET.get("sort", "medicineName")
        order = request.GET.get("order", "asc")

        query = {}
        if q:
            query["$or"] = [
                {"medicineName": {"$regex": q, "$options": "i"}},
                {"brand": {"$regex": q, "$options": "i"}},
                {"description": {"$regex": q, "$options": "i"}}
            ]
        if category:
            query["category"] = category
            
        price_query = {}
        if min_price:
            try:
                price_query["$gte"] = float(min_price)
            except ValueError:
                pass
        if max_price:
            try:
                price_query["$lte"] = float(max_price)
            except ValueError:
                pass
        if price_query:
            query["price"] = price_query

        # Retrieve & sort
        cursor = medicines_col.find(query)
        direction = 1 if order.lower() == "asc" else -1
        cursor.sort(sort_by, direction)
        
        medicines = list(cursor)
        return JsonResponse(medicines, safe=False)

    elif request.method == "POST":
        @jwt_admin_required
        def _create(req):
            body = get_json_body(req)
            name = body.get("medicineName")
            brand = body.get("brand")
            category = body.get("category")
            price = body.get("price")
            stock = body.get("stock")
            description = body.get("description", "")
            image = body.get("image", "")
            expiry_date = body.get("expiryDate", "")
            manufacturer = body.get("manufacturer", "")

            if not name or not brand or not category or price is None or stock is None:
                return JsonResponse({"error": "name, brand, category, price, and stock are required."}, status=400)
            
            try:
                price = float(price)
                stock = int(stock)
            except ValueError:
                return JsonResponse({"error": "Price must be a number, stock must be an integer."}, status=400)

            med_doc = {
                "medicineName": name,
                "brand": brand,
                "category": category,
                "price": price,
                "stock": stock,
                "description": description,
                "image": image,
                "expiryDate": expiry_date,
                "manufacturer": manufacturer
            }
            res = medicines_col.insert_one(med_doc)
            med_doc["_id"] = res.inserted_id
            return JsonResponse(med_doc, status=201)
        return _create(request)
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def medicine_detail(request, id):
    med = medicines_col.find_one({"_id": id})
    if not med:
        return JsonResponse({"error": "Medicine not found."}, status=404)

    if request.method == "GET":
        return JsonResponse(med)

    elif request.method == "PUT":
        @jwt_admin_required
        def _update(req):
            body = get_json_body(req)
            update_data = {}
            for field in ["medicineName", "brand", "category", "description", "image", "expiryDate", "manufacturer"]:
                if field in body:
                    update_data[field] = body[field]
            
            if "price" in body:
                try:
                    update_data["price"] = float(body["price"])
                except ValueError:
                    return JsonResponse({"error": "Price must be a number."}, status=400)
            if "stock" in body:
                try:
                    update_data["stock"] = int(body["stock"])
                except ValueError:
                    return JsonResponse({"error": "Stock must be an integer."}, status=400)

            if update_data:
                medicines_col.update_one({"_id": id}, {"$set": update_data})
                med.update(update_data)
            return JsonResponse(med)
        return _update(request)

    elif request.method == "DELETE":
        @jwt_admin_required
        def _delete(req):
            medicines_col.delete_one({"_id": id})
            return JsonResponse({"message": "Medicine deleted successfully."})
        return _delete(request)
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
def medicines_search(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    q = request.GET.get("q", "")
    query = {}
    if q:
        query["$or"] = [
            {"medicineName": {"$regex": q, "$options": "i"}},
            {"brand": {"$regex": q, "$options": "i"}},
            {"description": {"$regex": q, "$options": "i"}}
        ]
    meds = list(medicines_col.find(query))
    return JsonResponse(meds, safe=False)


@csrf_exempt
def medicines_by_category(request, category_name):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    meds = list(medicines_col.find({"category": category_name}))
    return JsonResponse(meds, safe=False)


@csrf_exempt
def medicines_low_stock(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    # Threshold for low stock is 10
    meds = list(medicines_col.find({"stock": {"$lt": 10}}))
    return JsonResponse(meds, safe=False)


# =====================================================================
# CART APIs
# =====================================================================

def get_or_create_cart(user_id):
    cart = cart_col.find_one({"userId": user_id})
    if not cart:
        cart = {
            "userId": user_id,
            "items": [],
            "total": 0.0
        }
        res = cart_col.insert_one(cart)
        cart["_id"] = res.inserted_id
    return cart

def recalculate_cart(cart):
    total = 0.0
    valid_items = []
    for item in cart["items"]:
        med = medicines_col.find_one({"_id": item["medicineId"]})
        if med:
            item["price"] = med["price"]
            total += item["price"] * item["quantity"]
            valid_items.append(item)
    cart["items"] = valid_items
    cart["total"] = total
    cart_col.update_one({"_id": cart["_id"]}, {"$set": {"items": valid_items, "total": total}})
    return cart

@csrf_exempt
@jwt_login_required
def cart_view(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    cart = get_or_create_cart(request.user["_id"])
    cart = recalculate_cart(cart)
    return JsonResponse(cart)


@csrf_exempt
@jwt_login_required
def cart_add(request):
    if request.method != "POST":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = get_json_body(request)
    medicine_id = body.get("medicineId")
    quantity = body.get("quantity", 1)

    if not medicine_id:
        return JsonResponse({"error": "medicineId is required."}, status=400)
    
    try:
        quantity = int(quantity)
        if quantity <= 0:
            return JsonResponse({"error": "Quantity must be greater than 0."}, status=400)
    except ValueError:
        return JsonResponse({"error": "Quantity must be an integer."}, status=400)

    med = medicines_col.find_one({"_id": medicine_id})
    if not med:
        return JsonResponse({"error": "Medicine not found."}, status=404)

    # Check if stock exists
    if med["stock"] < quantity:
        return JsonResponse({"error": f"Insufficient stock. Only {med['stock']} available."}, status=400)

    cart = get_or_create_cart(request.user["_id"])
    items = cart["items"]
    
    # Check if item already in cart
    found = False
    for item in items:
        if item["medicineId"] == medicine_id:
            # Check combined stock
            if med["stock"] < item["quantity"] + quantity:
                return JsonResponse({"error": f"Insufficient stock to add more. Only {med['stock']} total stock available."}, status=400)
            item["quantity"] += quantity
            found = True
            break
            
    if not found:
        items.append({
            "medicineId": medicine_id,
            "quantity": quantity,
            "price": med["price"]
        })
        
    cart["items"] = items
    cart = recalculate_cart(cart)
    return JsonResponse({"message": "Medicine added to cart.", "cart": cart})


@csrf_exempt
@jwt_login_required
def cart_update(request):
    if request.method != "PUT":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    body = get_json_body(request)
    medicine_id = body.get("medicineId")
    quantity = body.get("quantity")

    if not medicine_id or quantity is None:
        return JsonResponse({"error": "medicineId and quantity are required."}, status=400)

    try:
        quantity = int(quantity)
        if quantity < 0:
            return JsonResponse({"error": "Quantity cannot be negative."}, status=400)
    except ValueError:
        return JsonResponse({"error": "Quantity must be an integer."}, status=400)

    cart = get_or_create_cart(request.user["_id"])
    items = cart["items"]
    
    med = medicines_col.find_one({"_id": medicine_id})
    if not med and quantity > 0:
        return JsonResponse({"error": "Medicine not found."}, status=404)
        
    if med and med["stock"] < quantity:
        return JsonResponse({"error": f"Insufficient stock. Only {med['stock']} available."}, status=400)

    new_items = []
    for item in items:
        if item["medicineId"] == medicine_id:
            if quantity > 0:
                item["quantity"] = quantity
                new_items.append(item)
        else:
            new_items.append(item)
            
    cart["items"] = new_items
    cart = recalculate_cart(cart)
    return JsonResponse({"message": "Cart updated.", "cart": cart})


@csrf_exempt
@jwt_login_required
def cart_remove(request, id):
    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    cart = get_or_create_cart(request.user["_id"])
    items = [item for item in cart["items"] if item["medicineId"] != id]
    cart["items"] = items
    cart = recalculate_cart(cart)
    return JsonResponse({"message": "Item removed from cart.", "cart": cart})


@csrf_exempt
@jwt_login_required
def cart_clear(request):
    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    cart = get_or_create_cart(request.user["_id"])
    cart["items"] = []
    cart["total"] = 0.0
    cart_col.update_one({"_id": cart["_id"]}, {"$set": {"items": [], "total": 0.0}})
    return JsonResponse({"message": "Cart cleared.", "cart": cart})


# =====================================================================
# ORDER APIs
# =====================================================================

@csrf_exempt
@jwt_login_required
def orders_list_create(request):
    user = request.user
    if request.method == "GET":
        if user["role"] == "admin":
            # Admin can view all orders
            orders = list(orders_col.find({}))
        else:
            # Customer views their own orders
            orders = list(orders_col.find({"userId": user["_id"]}))
        
        # Enriched orders with details
        for o in orders:
            # Resolve customer email & name
            u_doc = users_col.find_one({"_id": o["userId"]})
            o["userName"] = u_doc["name"] if u_doc else "Unknown User"
            o["userEmail"] = u_doc["email"] if u_doc else "Unknown Email"
            
            # Resolve medicine details
            for item in o["items"]:
                med = medicines_col.find_one({"_id": item["medicineId"]})
                item["medicineName"] = med["medicineName"] if med else "Unknown Medicine"
                item["brand"] = med["brand"] if med else ""
                item["price"] = med["price"] if med else 0.0
                
        return JsonResponse(orders, safe=False)

    elif request.method == "POST":
        # Place order
        body = get_json_body(request)
        payment_method = body.get("paymentMethod", "Cash on Delivery")
        
        cart = cart_col.find_one({"userId": user["_id"]})
        if not cart or not cart.get("items"):
            return JsonResponse({"error": "Your shopping cart is empty."}, status=400)
            
        cart = recalculate_cart(cart)
        if not cart.get("items"):
            return JsonResponse({"error": "Your shopping cart items are invalid."}, status=400)

        # Validate stock for all items first
        for item in cart["items"]:
            med = medicines_col.find_one({"_id": item["medicineId"]})
            if not med:
                return JsonResponse({"error": f"Product no longer exists."}, status=400)
            if med["stock"] < item["quantity"]:
                return JsonResponse({"error": f"Insufficient stock for {med['medicineName']}. Only {med['stock']} units left."}, status=400)

        # Deduct stock
        for item in cart["items"]:
            medicines_col.update_one(
                {"_id": item["medicineId"]},
                {"$inc": {"stock": -item["quantity"]}}
            )

        # Create Order document
        order_doc = {
            "userId": user["_id"],
            "items": [{"medicineId": item["medicineId"], "quantity": item["quantity"]} for item in cart["items"]],
            "totalAmount": cart["total"],
            "paymentMethod": payment_method,
            "status": "Pending",
            "createdAt": datetime.utcnow().isoformat()
        }
        
        res = orders_col.insert_one(order_doc)
        order_id = res.inserted_id
        order_doc["_id"] = order_id
        
        # Clear user's cart
        cart_col.update_one({"_id": cart["_id"]}, {"$set": {"items": [], "total": 0.0}})
        
        return JsonResponse({"message": "Order placed successfully.", "order": order_doc}, status=201)
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


@csrf_exempt
@jwt_login_required
def order_detail_update_delete(request, id):
    user = request.user
    order = orders_col.find_one({"_id": id})
    if not order:
        return JsonResponse({"error": "Order not found."}, status=404)

    # Permission check: Admin or the customer who placed the order
    if user["role"] != "admin" and order["userId"] != user["_id"]:
        return JsonResponse({"error": "Permission denied."}, status=403)

    if request.method == "GET":
        # Enrich order details
        u_doc = users_col.find_one({"_id": order["userId"]})
        order["userName"] = u_doc["name"] if u_doc else "Unknown User"
        order["userEmail"] = u_doc["email"] if u_doc else "Unknown Email"
        
        for item in order["items"]:
            med = medicines_col.find_one({"_id": item["medicineId"]})
            item["medicineName"] = med["medicineName"] if med else "Unknown Medicine"
            item["brand"] = med["brand"] if med else ""
            item["price"] = med["price"] if med else 0.0
            
        return JsonResponse(order)

    elif request.method == "PUT":
        # Update order status
        body = get_json_body(request)
        new_status = body.get("status")
        
        if not new_status:
            return JsonResponse({"error": "Status is required."}, status=400)

        # Status flow rules:
        # Customers can only set status to "Cancelled" if the order is currently "Pending".
        # Admins can set status to "Dispatched", "Delivered", "Cancelled", "Pending".
        current_status = order["status"]
        
        if user["role"] != "admin":
            if new_status == "Cancelled":
                if current_status != "Pending":
                    return JsonResponse({"error": "Order cannot be cancelled after it is dispatched or delivered."}, status=400)
            else:
                return JsonResponse({"error": "Customers can only cancel orders before dispatch."}, status=403)
        
        # If status changes to "Cancelled", restore stocks
        if new_status == "Cancelled" and current_status != "Cancelled":
            for item in order["items"]:
                medicines_col.update_one(
                    {"_id": item["medicineId"]},
                    {"$inc": {"stock": item["quantity"]}}
                )
        
        # If status was "Cancelled" but changed back (e.g. by admin to Pending), re-deduct stocks
        if current_status == "Cancelled" and new_status != "Cancelled":
            # Check stock availability first
            for item in order["items"]:
                med = medicines_col.find_one({"_id": item["medicineId"]})
                if not med or med["stock"] < item["quantity"]:
                    return JsonResponse({"error": f"Cannot restore order. Insufficient stock for {med['medicineName'] if med else 'medicine'}."}, status=400)
            
            # Deduct stock again
            for item in order["items"]:
                medicines_col.update_one(
                    {"_id": item["medicineId"]},
                    {"$inc": {"stock": -item["quantity"]}}
                )

        orders_col.update_one({"_id": id}, {"$set": {"status": new_status}})
        order["status"] = new_status
        return JsonResponse({"message": f"Order status updated to {new_status}.", "order": order})

    elif request.method == "DELETE":
        # Admin delete
        if user["role"] != "admin":
            return JsonResponse({"error": "Admin privileges required."}, status=403)
        orders_col.delete_one({"_id": id})
        return JsonResponse({"message": "Order deleted successfully."})
        
    else:
        return JsonResponse({"error": "Method not allowed."}, status=405)


# =====================================================================
# DASHBOARD APIs (ADMIN ONLY)
# =====================================================================

@csrf_exempt
@jwt_admin_required
def admin_dashboard(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)

    total_medicines = medicines_col.count_documents({})
    total_categories = categories_col.count_documents({})
    total_orders = orders_col.count_documents({})
    total_users = users_col.count_documents({})
    
    # Low stock limit < 10
    low_stock_medicines = medicines_col.count_documents({"stock": {"$lt": 10}})
    
    # Revenue summary
    delivered_orders = list(orders_col.find({"status": "Delivered"}))
    revenue = sum(o.get("totalAmount", 0.0) for o in delivered_orders)

    return JsonResponse({
        "totalMedicines": total_medicines,
        "totalCategories": total_categories,
        "totalOrders": total_orders,
        "totalUsers": total_users,
        "lowStockMedicines": low_stock_medicines,
        "revenueSummary": revenue
    })


@csrf_exempt
@jwt_admin_required
def admin_dashboard_revenue(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
        
    orders = list(orders_col.find({}))
    total_revenue = 0.0
    pending_revenue = 0.0
    cancelled_revenue = 0.0
    
    for o in orders:
        amt = o.get("totalAmount", 0.0)
        status = o.get("status", "Pending")
        if status == "Delivered":
            total_revenue += amt
        elif status == "Pending" or status == "Dispatched":
            pending_revenue += amt
        elif status == "Cancelled":
            cancelled_revenue += amt
            
    return JsonResponse({
        "deliveredRevenue": total_revenue,
        "pendingRevenue": pending_revenue,
        "cancelledRevenue": cancelled_revenue,
        "totalTransactions": len(orders)
    })


@csrf_exempt
@jwt_admin_required
def admin_dashboard_low_stock(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    # Return medicines with stock < 10
    low_stock = list(medicines_col.find({"stock": {"$lt": 10}}))
    return JsonResponse(low_stock, safe=False)


@csrf_exempt
@jwt_admin_required
def admin_dashboard_recent_orders(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    # Sort orders by time descending and limit to 5
    # Since our Mock DB supports sorting, we sort by 'createdAt' descending
    cursor = orders_col.find({})
    cursor.sort("createdAt", -1)
    recent = list(cursor.limit(5))
    
    # Resolve details for recent orders
    for o in recent:
        u_doc = users_col.find_one({"_id": o["userId"]})
        o["userName"] = u_doc["name"] if u_doc else "Unknown User"
        o["userEmail"] = u_doc["email"] if u_doc else "Unknown Email"
        
        for item in o["items"]:
            med = medicines_col.find_one({"_id": item["medicineId"]})
            item["medicineName"] = med["medicineName"] if med else "Unknown Medicine"
            item["price"] = med["price"] if med else 0.0
            
    return JsonResponse(recent, safe=False)


# =====================================================================
# USER MANAGEMENT APIs (ADMIN ONLY)
# =====================================================================

@csrf_exempt
@jwt_admin_required
def admin_users_list(request):
    if request.method != "GET":
        return JsonResponse({"error": "Method not allowed."}, status=405)
    users = list(users_col.find({}))
    # Remove password hashes for safety
    for u in users:
        u.pop("password", None)
    return JsonResponse(users, safe=False)


@csrf_exempt
@jwt_admin_required
def admin_user_status(request, id):
    if request.method != "PUT":
        return JsonResponse({"error": "Method not allowed."}, status=405)
        
    user = users_col.find_one({"_id": id})
    if not user:
        return JsonResponse({"error": "User not found."}, status=404)
        
    body = get_json_body(request)
    status = body.get("status")  # "Active" or "Blocked"
    is_blocked = body.get("isBlocked")
    
    update_data = {}
    if status is not None:
        update_data["status"] = status
        update_data["isBlocked"] = (status == "Blocked")
    elif is_blocked is not None:
        update_data["isBlocked"] = bool(is_blocked)
        update_data["status"] = "Blocked" if is_blocked else "Active"
    else:
        # Toggle current status
        current_blocked = user.get("isBlocked", False)
        new_blocked = not current_blocked
        update_data["isBlocked"] = new_blocked
        update_data["status"] = "Blocked" if new_blocked else "Active"

    users_col.update_one({"_id": id}, {"$set": update_data})
    
    # Admin cannot block themselves
    if id == request.user["_id"] and update_data.get("isBlocked"):
        users_col.update_one({"_id": id}, {"$set": {"isBlocked": False, "status": "Active"}})
        return JsonResponse({"error": "Admins cannot block their own accounts."}, status=400)
        
    return JsonResponse({"message": "User status updated successfully.", "isBlocked": update_data.get("isBlocked")})


@csrf_exempt
@jwt_admin_required
def admin_user_delete(request, id):
    if request.method != "DELETE":
        return JsonResponse({"error": "Method not allowed."}, status=405)
        
    # Check if user exists
    user = users_col.find_one({"_id": id})
    if not user:
        return JsonResponse({"error": "User not found."}, status=404)
        
    if id == request.user["_id"]:
        return JsonResponse({"error": "Admins cannot delete their own accounts."}, status=400)

    users_col.delete_one({"_id": id})
    return JsonResponse({"message": "User deleted successfully."})
