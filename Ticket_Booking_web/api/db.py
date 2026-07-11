import os
import json
import uuid
import re
from datetime import datetime

try:
    import pymongo
    from pymongo.errors import ServerSelectionTimeoutError
    from bson import ObjectId
except ImportError:
    pymongo = None
    ServerSelectionTimeoutError = Exception
    ObjectId = None

from django.contrib.auth.hashers import make_password

# Database URI (can be overridden by environment variable)
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = "pharmacy_db"
MOCK_DB_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "db_store.json")

# Default seeding data
DEFAULT_CATEGORIES = [
    {"categoryName": "Pain Relief", "description": "Medicines for reducing physical pain and inflammation."},
    {"categoryName": "Diabetes", "description": "Medicines to manage blood sugar levels."},
    {"categoryName": "Vitamin Supplements", "description": "Nutritional and vitamin supplements."},
    {"categoryName": "Skin Care", "description": "Creams and lotions for skin health."},
    {"categoryName": "Allergy", "description": "Medicines for anti-allergic treatments."},
    {"categoryName": "Baby Care", "description": "Products specially formulated for infant care."}
]

DEFAULT_MEDICINES = [
    {
        "medicineName": "Paracetamol 650",
        "brand": "Cipla",
        "category": "Pain Relief",
        "price": 45.0,
        "stock": 120,
        "description": "Standard pain relief and fever reducing medicine.",
        "image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2027-12-31",
        "manufacturer": "Cipla Ltd"
    },
    {
        "medicineName": "Dolo 650",
        "brand": "Micro Labs",
        "category": "Pain Relief",
        "price": 38.0,
        "stock": 90,
        "description": "Widely used for fever control and pain relief.",
        "image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2027-10-30",
        "manufacturer": "Micro Labs"
    },
    {
        "medicineName": "Metformin 500",
        "brand": "Sun Pharma",
        "category": "Diabetes",
        "price": 80.0,
        "stock": 65,
        "description": "Oral diabetes medicine that helps control blood sugar levels.",
        "image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2028-01-15",
        "manufacturer": "Sun Pharmaceutical Industries"
    },
    {
        "medicineName": "Vitamin C Tablets",
        "brand": "Himalaya",
        "category": "Vitamin Supplements",
        "price": 150.0,
        "stock": 50,
        "description": "Daily immunity booster and antioxidant supplement.",
        "image": "https://images.unsplash.com/photo-1616679911721-eff6eec18fcd?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2027-06-30",
        "manufacturer": "Himalaya Wellness"
    },
    {
        "medicineName": "Cetirizine",
        "brand": "Dr. Reddy's",
        "category": "Allergy",
        "price": 65.0,
        "stock": 150,
        "description": "Antihistamine that reduces the natural chemical histamine in the body.",
        "image": "https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2027-08-15",
        "manufacturer": "Dr. Reddy's Laboratories"
    },
    {
        "medicineName": "Moisturizing Cream",
        "brand": "Nivea",
        "category": "Skin Care",
        "price": 220.0,
        "stock": 40,
        "description": "Intense moisture care for soft and supple skin.",
        "image": "https://images.unsplash.com/photo-1608248597279-f99d160bfcbc?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2028-05-31",
        "manufacturer": "Nivea India"
    },
    {
        "medicineName": "Baby Lotion",
        "brand": "Johnson's",
        "category": "Baby Care",
        "price": 180.0,
        "stock": 70,
        "description": "Gentle baby lotion designed to protect delicate baby skin.",
        "image": "https://images.unsplash.com/photo-1519689680058-324335c77ebe?w=500&auto=format&fit=crop&q=60",
        "expiryDate": "2028-03-31",
        "manufacturer": "Johnson & Johnson"
    }
]

DEFAULT_USERS = [
    {
        "name": "Admin",
        "email": "admin@pharmacy.com",
        "phone": "9999999999",
        "password": "admin123", # Will be hashed during seeding
        "address": "Pharmacy HQ, Main Street",
        "role": "admin"
    },
    {
        "name": "Rahul Sharma",
        "email": "rahul@gmail.com",
        "phone": "9876543210",
        "password": "rahul123", # Will be hashed during seeding
        "address": "123, Park Avenue, Delhi",
        "role": "customer"
    },
    {
        "name": "Priya Verma",
        "email": "priya@gmail.com",
        "phone": "9876543211",
        "password": "priya123", # Will be hashed during seeding
        "address": "456, Rose Garden, Mumbai",
        "role": "customer"
    }
]

def normalize_id(value):
    """Convert string IDs into Mongo ObjectId values when the app is using MongoDB."""
    if ObjectId is None or not isinstance(value, str):
        return value
    try:
        return ObjectId(value)
    except Exception:
        return value

def to_jsonable(value):
    """Recursively convert MongoDB-specific objects into JSON-safe values."""
    if isinstance(value, dict):
        return {str(k): to_jsonable(v) for k, v in value.items()}
    if isinstance(value, list):
        return [to_jsonable(v) for v in value]
    if isinstance(value, tuple):
        return [to_jsonable(v) for v in value]
    if isinstance(value, datetime):
        return value.isoformat()
    if ObjectId is not None and isinstance(value, ObjectId):
        return str(value)
    if type(value).__name__ == "ObjectId":
        return str(value)
    return value

# Helper query evaluator for Mock DB
def matches_query(doc, query):
    if not query:
        return True
    for key, value in query.items():
        if key == "$or":
            if not any(matches_query(doc, q) for q in value):
                return False
        elif key == "$and":
            if not all(matches_query(doc, q) for q in value):
                return False
        else:
            if key not in doc:
                return False
            doc_val = doc[key]
            if isinstance(value, dict):
                for op, op_val in value.items():
                    if op == "$regex":
                        options = value.get("$options", "")
                        flags = re.IGNORECASE if "i" in options else 0
                        if not re.search(str(op_val), str(doc_val), flags):
                            return False
                    elif op == "$options":
                        continue
                    elif op == "$lt":
                        if not (doc_val < op_val):
                            return False
                    elif op == "$lte":
                        if not (doc_val <= op_val):
                            return False
                    elif op == "$gt":
                        if not (doc_val > op_val):
                            return False
                    elif op == "$gte":
                        if not (doc_val >= op_val):
                            return False
                    elif op == "$ne":
                        if doc_val == op_val:
                            return False
                    elif op == "$in":
                        if doc_val not in op_val:
                            return False
            else:
                if doc_val != value:
                    return False
    return True


class MockCursor:
    def __init__(self, data):
        self._data = data

    def __iter__(self):
        return iter(self._data)

    def sort(self, key, direction=1):
        # direction = 1 for ASC, -1 for DESC
        reverse = direction == -1
        self._data.sort(key=lambda x: x.get(key, ""), reverse=reverse)
        return self

    def limit(self, count):
        self._data = self._data[:count]
        return self


class MockCollection:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    def _get_data(self):
        return self.db.data.get(self.name, [])

    def _save_data(self, data):
        self.db.data[self.name] = data
        self.db.save()

    def find(self, query=None, projection=None):
        data = self._get_data()
        results = [doc for doc in data if matches_query(doc, query)]
        if projection:
            projected = []
            for doc in results:
                new_doc = {}
                for k, v in doc.items():
                    if projection.get(k, 1) != 0:
                        new_doc[k] = v
                projected.append(new_doc)
            results = projected
        return MockCursor(results)

    def find_one(self, query=None, projection=None):
        data = self._get_data()
        for doc in data:
            if matches_query(doc, query):
                if projection:
                    new_doc = {}
                    for k, v in doc.items():
                        if projection.get(k, 1) != 0:
                            new_doc[k] = v
                    return new_doc
                return doc
        return None

    def insert_one(self, document):
        if "_id" not in document:
            document["_id"] = uuid.uuid4().hex
        if "createdAt" not in document:
            document["createdAt"] = datetime.utcnow().isoformat()
        
        data = self._get_data()
        data.append(document)
        self._save_data(data)
        
        class InsertResult:
            def __init__(self, inserted_id):
                self.inserted_id = inserted_id
        return InsertResult(document["_id"])

    def insert_many(self, documents):
        data = self._get_data()
        inserted_ids = []
        for doc in documents:
            if "_id" not in doc:
                doc["_id"] = uuid.uuid4().hex
            if "createdAt" not in doc:
                doc["createdAt"] = datetime.utcnow().isoformat()
            data.append(doc)
            inserted_ids.append(doc["_id"])
        self._save_data(data)
        class InsertManyResult:
            def __init__(self, ids):
                self.inserted_ids = ids
        return InsertManyResult(inserted_ids)

    def update_one(self, filter_query, update, upsert=False):
        data = self._get_data()
        found = False
        
        for idx, doc in enumerate(data):
            if matches_query(doc, filter_query):
                found = True
                new_doc = doc.copy()
                
                if "$set" in update:
                    for k, v in update["$set"].items():
                        new_doc[k] = v
                if "$inc" in update:
                    for k, v in update["$inc"].items():
                        new_doc[k] = new_doc.get(k, 0) + v
                
                data[idx] = new_doc
                break
                
        if not found and upsert:
            new_doc = filter_query.copy()
            if "$set" in update:
                for k, v in update["$set"].items():
                    new_doc[k] = v
            if "_id" not in new_doc:
                new_doc["_id"] = uuid.uuid4().hex
            data.append(new_doc)
            found = True
            
        self._save_data(data)
        
        class UpdateResult:
            def __init__(self, matched, modified):
                self.matched_count = matched
                self.modified_count = modified
        return UpdateResult(1 if found else 0, 1 if found else 0)

    def delete_one(self, filter_query):
        data = self._get_data()
        found_idx = -1
        for idx, doc in enumerate(data):
            if matches_query(doc, filter_query):
                found_idx = idx
                break
        if found_idx != -1:
            data.pop(found_idx)
            self._save_data(data)
            deleted_count = 1
        else:
            deleted_count = 0
            
        class DeleteResult:
            def __init__(self, count):
                self.deleted_count = count
        return DeleteResult(deleted_count)

    def delete_many(self, filter_query):
        data = self._get_data()
        original_len = len(data)
        data = [doc for doc in data if not matches_query(doc, filter_query)]
        deleted_count = original_len - len(data)
        self._save_data(data)
        
        class DeleteResult:
            def __init__(self, count):
                self.deleted_count = count
        return DeleteResult(deleted_count)

    def count_documents(self, filter_query):
        data = self._get_data()
        return sum(1 for doc in data if matches_query(doc, filter_query))

    def distinct(self, key):
        data = self._get_data()
        values = set()
        for doc in data:
            if key in doc:
                values.add(doc[key])
        return list(values)


class MockDatabase:
    def __init__(self):
        self.filepath = MOCK_DB_FILE
        self.data = {}
        self.load()

    def load(self):
        if os.path.exists(self.filepath):
            try:
                with open(self.filepath, "r") as f:
                    self.data = json.load(f)
            except Exception:
                self.data = {}
        else:
            self.data = {}

    def save(self):
        try:
            with open(self.filepath, "w") as f:
                json.dump(self.data, f, indent=4)
        except Exception as e:
            print(f"Error saving MockDB to file: {e}")

    def get_collection(self, name):
        return MockCollection(self, name)

    def __getitem__(self, name):
        return self.get_collection(name)


# Establish Database connection
db = None
is_mock = False

if pymongo is None:
    db = MockDatabase()
    is_mock = True
    print("Database: PyMongo is not installed. Falling back to the local file-based database.")
else:
    try:
        client = pymongo.MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
        client.server_info()
        db = client[DB_NAME]
        print("Database: Connected to MongoDB at", MONGO_URI)
    except (ServerSelectionTimeoutError, Exception) as e:
        db = MockDatabase()
        is_mock = True
        print(f"Database: MongoDB server not found. Falling back to local file-based database. (Error: {e})")

users_col = db["users"]
categories_col = db["categories"]
medicines_col = db["medicines"]
cart_col = db["cart"]
orders_col = db["orders"]

def seed_database():
    """Seeds the database with default sample data if collections are empty."""
    if categories_col.count_documents({}) == 0:
        categories_col.insert_many(DEFAULT_CATEGORIES)
        print("Seeded Categories.")

    if medicines_col.count_documents({}) == 0:
        medicines_col.insert_many(DEFAULT_MEDICINES)
        print("Seeded Medicines.")

    if users_col.count_documents({}) == 0:
        hashed_users = []
        for user in DEFAULT_USERS:
            user_copy = user.copy()
            user_copy["password"] = make_password(user["password"])
            hashed_users.append(user_copy)
        users_col.insert_many(hashed_users)
        print("Seeded Users.")

    if orders_col.count_documents({}) == 0:
        rahul = users_col.find_one({"name": "Rahul Sharma"})
        para = medicines_col.find_one({"medicineName": "Paracetamol 650"})
        if rahul and para:
            order1 = {
                "userId": rahul["_id"],
                "items": [
                    {"medicineId": para["_id"], "quantity": 2}
                ],
                "totalAmount": 90.0,
                "paymentMethod": "Cash on Delivery",
                "status": "Pending"
            }
            orders_col.insert_one(order1)

        priya = users_col.find_one({"name": "Priya Verma"})
        vitc = medicines_col.find_one({"medicineName": "Vitamin C Tablets"})
        if priya and vitc:
            order2 = {
                "userId": priya["_id"],
                "items": [
                    {"medicineId": vitc["_id"], "quantity": 1}
                ],
                "totalAmount": 150.0,
                "paymentMethod": "Cash on Delivery",
                "status": "Delivered"
            }
            orders_col.insert_one(order2)
        print("Seeded Orders.")

seed_database()
