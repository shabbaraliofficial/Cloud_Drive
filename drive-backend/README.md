# Cloud Drive Backend (MongoDB + FastAPI)

Production-style modular backend for a Drive-like app.

## Stack
- Python + FastAPI
- MongoDB (Motor async driver)
- JWT access + refresh
- Password hashing (bcrypt)
- OTP support (email via SMTP)
- AWS S3 integration for file storage (auto mock path fallback if not configured)

## Project Structure
```text
app/
  main.py
  core/
    config.py
    logging.py
  database/
    mongodb.py
  routes/
    api.py
    deps.py
    auth_routes.py
    user_routes.py
    file_routes.py
    folder_routes.py
    drive_routes.py
    search_routes.py
    storage_routes.py
    dashboard_routes.py
  schemas/
    auth_schema.py
    user_schema.py
    file_schema.py
    search_schema.py
    storage_schema.py
    dashboard_schema.py
    common_schema.py
  services/
    email_service.py
    otp_service.py
    s3_service.py
  utils/
    jwt_handler.py
    password_handler.py
    mongo_helpers.py
```

## Setup
1. `cd drive-backend`
2. `python -m pip install -r requirements.txt`
3. Copy `.env.example` to `.env`
4. Ensure MongoDB is running on `mongodb://localhost:27017`
5. Run server:
   - `python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000`
6. Open docs:
   - `http://127.0.0.1:8000/docs`

## Key Endpoints

Authentication:
- `POST /api/auth/register`
- `POST /api/auth/verify-otp`
- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `POST /api/auth/forgot-password`
- `POST /api/auth/reset-password`
- `POST /api/auth/logout`
- `POST /api/auth/social/google`
- `POST /api/auth/social/facebook`
- `POST /api/auth/social/apple`

User:
- `GET /api/user/profile`
- `PATCH /api/user/profile`
- `POST /api/user/change-password`
- `PATCH /api/user/auth-settings`

Files/Folders:
- `POST /api/files/upload`
- `POST /api/files/upload-folder`
- `PATCH /api/files/{file_id}/rename`
- `DELETE /api/files/{file_id}`
- `POST /api/files/{file_id}/restore`
- `DELETE /api/files/{file_id}/permanent`
- `PATCH /api/files/{file_id}/move`
- `POST /api/folders`
- `GET /api/folders`
- `PATCH /api/folders/{folder_id}/rename`
- `DELETE /api/folders/{folder_id}`
- `POST /api/folders/{folder_id}/restore`

Drive/Search/Storage/Dashboard:
- `GET /api/drive/files`
- `GET /api/drive/recent`
- `GET /api/drive/starred`
- `GET /api/drive/shared`
- `PATCH /api/drive/{file_id}/star`
- `PATCH /api/drive/{file_id}/move`
- `POST /api/drive/{file_id}/share-user`
- `GET /api/search?q=...`
- `GET /api/search/files?q=...`
- `GET /api/search/folders?q=...`
- `GET /api/storage/usage`
- `GET /api/storage/available`
- `GET /api/dashboard`
