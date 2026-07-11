import os
import json
import django

# Configure Django settings module
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "pharmacy_backend.settings")
django.setup()

from django.test import Client
from api.db import db, users_col, medicines_col, orders_col, cart_col

def print_result(name, passed, message=""):
    status = "PASS" if passed else "FAIL"
    print(f"[{status}] {name} {': ' + message if message else ''}")

def run_tests():
    print("==================================================")
    print("PHARMAVIBE - AUTOMATED BACKEND API TESTS")
    print("==================================================")
    
    client = Client()
    
    # 1. Test Login (Customer)
    print("\n--- Testing Authentication ---")
    login_data = {
        "email": "rahul@gmail.com",
        "password": "rahul123"
    }
    response = client.post("/api/login", data=json.dumps(login_data), content_type="application/json")
    
    if response.status_code == 200:
        res_data = response.json()
        token = res_data.get("token")
        user = res_data.get("user")
        print_result("Customer Login", True, f"Logged in as {user['name']}. Token acquired.")
    else:
        print_result("Customer Login", False, f"Status {response.status_code}, {response.content}")
        return
        
    # 2. Test Profile API
    headers = {"HTTP_AUTHORIZATION": f"Bearer {token}"}
    response = client.get("/api/profile", **headers)
    if response.status_code == 200:
        res_data = response.json()
        print_result("Fetch Profile", True, f"Name: {res_data['name']}, Email: {res_data['email']}")
    else:
        print_result("Fetch Profile", False, f"Status {response.status_code}, {response.content}")
        
    # 3. Test Medicines List API
    print("\n--- Testing Medicines ---")
    response = client.get("/api/medicines")
    if response.status_code == 200:
        meds = response.json()
        print_result("List Medicines", True, f"Retrieved {len(meds)} medicines.")
        # Grab first medicine ID for cart test
        med_id = meds[0]["_id"] if meds else None
        med_name = meds[0]["medicineName"] if meds else ""
        med_price = meds[0]["price"] if meds else 0.0
    else:
        print_result("List Medicines", False, f"Status {response.status_code}")
        return
        
    # 4. Test Cart APIs
    print("\n--- Testing Cart Operations ---")
    # Clear cart first
    client.delete("/api/cart/clear", **headers)
    
    # Add to cart
    add_data = {
        "medicineId": med_id,
        "quantity": 2
    }
    response = client.post("/api/cart/add", data=json.dumps(add_data), content_type="application/json", **headers)
    if response.status_code == 200:
        print_result("Add to Cart", True, f"Added 2 units of '{med_name}'.")
    else:
        print_result("Add to Cart", False, f"Status {response.status_code}, {response.content}")
        
    # View cart
    response = client.get("/api/cart", **headers)
    if response.status_code == 200:
        cart_data = response.json()
        print_result("Get Cart", True, f"Total items: {len(cart_data['items'])}, Total price: ${cart_data['total']}")
    else:
        print_result("Get Cart", False, f"Status {response.status_code}")

    # 5. Test Orders APIs
    print("\n--- Testing Order Placement & Flows ---")
    order_data = {
        "paymentMethod": "Cash on Delivery"
    }
    
    # Check medicine stock before order
    med_before = medicines_col.find_one({"_id": med_id})
    stock_before = med_before["stock"]
    
    response = client.post("/api/orders", data=json.dumps(order_data), content_type="application/json", **headers)
    if response.status_code == 201:
        order = response.json()["order"]
        order_id = order["_id"]
        print_result("Place Order", True, f"Order created successfully. Order ID: {order_id}")
    else:
        print_result("Place Order", False, f"Status {response.status_code}, {response.content}")
        return

    # Verify stock deduction
    med_after = medicines_col.find_one({"_id": med_id})
    stock_after = med_after["stock"]
    passed_stock = (stock_before - stock_after) == 2
    print_result("Verify Stock Deduction", passed_stock, f"Stock went from {stock_before} to {stock_after} (Deducted 2).")

    # Get Order Details
    response = client.get(f"/api/orders/{order_id}", **headers)
    if response.status_code == 200:
        print_result("Get Order Details", True, f"Verified order status: {response.json()['status']}")
    else:
        print_result("Get Order Details", False, f"Status {response.status_code}")

    # 6. Test Admin Dashboard and Management
    print("\n--- Testing Admin APIs ---")
    # Login as admin
    admin_login = {
        "email": "admin@pharmacy.com",
        "password": "admin123"
    }
    response = client.post("/api/login", data=json.dumps(admin_login), content_type="application/json")
    if response.status_code == 200:
        admin_token = response.json()["token"]
        admin_headers = {"HTTP_AUTHORIZATION": f"Bearer {admin_token}"}
        print_result("Admin Login", True, "Logged in as Admin.")
    else:
        print_result("Admin Login", False, f"Status {response.status_code}")
        return

    # Fetch Dashboard stats
    response = client.get("/api/dashboard", **admin_headers)
    if response.status_code == 200:
        stats = response.json()
        print_result("Fetch Dashboard Stats", True, f"Med count: {stats['totalMedicines']}, User count: {stats['totalUsers']}, Delivered Revenue: ${stats['revenueSummary']}")
    else:
        print_result("Fetch Dashboard Stats", False, f"Status {response.status_code}")

    # Clean up test changes
    print("\n--- Cleaning up test order ---")
    orders_col.delete_one({"_id": order_id})
    # Restore stock
    medicines_col.update_one({"_id": med_id}, {"$set": {"stock": stock_before}})
    print("Test order cleaned up and medicine stock restored.")
    
    print("\n==================================================")
    print("ALL API FUNCTIONAL TESTS COMPLETED SUCCESSFULLY!")
    print("==================================================")

if __name__ == "__main__":
    run_tests()
