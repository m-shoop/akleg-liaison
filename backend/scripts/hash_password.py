"""
Quick utility to generate an argon2id password hash.

Usage:
    python scripts/hash_password.py
"""
from app.services.auth_service import hash_password

if __name__ == "__main__":
    import getpass
    password = getpass.getpass("Password: ")
    print(hash_password(password))
