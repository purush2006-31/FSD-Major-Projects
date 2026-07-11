from django.urls import path
from api import views

urlpatterns = [
    # Authentication
    path("register", views.auth_register, name="auth_register"),
    path("login", views.auth_login, name="auth_login"),
    path("logout", views.auth_logout, name="auth_logout"),
    path("profile", views.user_profile, name="user_profile"),

    # Categories
    path("categories", views.categories_list, name="categories_list"),
    path("categories/<str:id>", views.category_detail, name="category_detail"),

    # Medicines
    path("medicines", views.medicines_list, name="medicines_list"),
    path("medicines/<str:id>", views.medicine_detail, name="medicine_detail"),
    path("medicines/search", views.medicines_search, name="medicines_search"),
    path("medicines/category/<str:category_name>", views.medicines_by_category, name="medicines_by_category"),
    path("medicines/low-stock", views.medicines_low_stock, name="medicines_low_stock"),

    # Cart
    path("cart", views.cart_view, name="cart_view"),
    path("cart/add", views.cart_add, name="cart_add"),
    path("cart/update", views.cart_update, name="cart_update"),
    path("cart/remove/<str:id>", views.cart_remove, name="cart_remove"),
    path("cart/clear", views.cart_clear, name="cart_clear"),

    # Orders
    path("orders", views.orders_list_create, name="orders_list_create"),
    path("orders/<str:id>", views.order_detail_update_delete, name="order_detail_update_delete"),

    # Admin Dashboard
    path("dashboard", views.admin_dashboard, name="admin_dashboard"),
    path("dashboard/revenue", views.admin_dashboard_revenue, name="admin_dashboard_revenue"),
    path("dashboard/low-stock", views.admin_dashboard_low_stock, name="admin_dashboard_low_stock"),
    path("dashboard/recent-orders", views.admin_dashboard_recent_orders, name="admin_dashboard_recent_orders"),

    # Admin User Management
    path("users", views.admin_users_list, name="admin_users_list"),
    path("users/<str:id>/status", views.admin_user_status, name="admin_user_status"),
    path("users/<str:id>", views.admin_user_delete, name="admin_user_delete"),
]
