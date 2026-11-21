from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_migrate import Migrate
from werkzeug.security import generate_password_hash, check_password_hash
from models import db, User, Solve

app = Flask(__name__)
CORS(app)

# Configurazione SQLite come nelle slide della prof (Slide 5 e 6)
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///app.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db.init_app(app)
migrate = Migrate(app, db)


# --- ROTTA DI CONTROLLO ---
@app.route("/api/status", methods=["GET"])
def status():
    return jsonify({"status": "online", "message": "CubeFlow Backend Ready"})


# --- AUTENTICAZIONE (Register & Login) ---
@app.route("/api/register", methods=["POST"])
def register():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    email = data.get("email", "").strip()
    password = data.get("password", "")

    if not username or not email or not password:
        return jsonify({"error": "All fields are required"}), 400

    existing = db.session.scalar(
        db.select(User).where((User.username == username) | (User.email == email))
    )
    if existing:
        return jsonify({"error": "Username or email already exists"}), 409

    user = User(
        username=username,
        email=email,
        password_hash=generate_password_hash(password),
    )
    db.session.add(user)
    db.session.commit()

    return jsonify({"message": "User registered", "user": user.to_dict()}), 201


@app.route("/api/login", methods=["POST"])
def login():
    data = request.get_json() or {}
    username = data.get("username", "").strip()
    password = data.get("password", "")

    user = db.session.scalar(db.select(User).where(User.username == username))
    if not user or not check_password_hash(user.password_hash, password):
        return jsonify({"error": "Invalid credentials"}), 401

    return jsonify({"message": "Login successful", "user": user.to_dict()}), 200


# --- OPERAZIONI CRUD SUI TEMPI (Slide 2: add, get, scalars, delete, commit) ---

# CREATE: Salva un nuovo tempo
@app.route("/api/solves", methods=["POST"])
def create_solve():
    data = request.get_json() or {}
    user_id = data.get("user_id")
    time_ms = data.get("time_ms")
    scramble = data.get("scramble", "Free Timer")
    penalty = data.get("penalty", "OK")

    if user_id is None or time_ms is None:
        return jsonify({"error": "user_id and time_ms are required"}), 400

    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    solve = Solve(
        user_id=user.id,
        time_ms=int(time_ms),
        scramble=scramble,
        penalty=penalty,
    )
    db.session.add(solve)
    db.session.commit()

    return jsonify(solve.to_dict()), 201


# READ: Leggi tutti i tempi di un utente (dal più recente)
@app.route("/api/users/<int:user_id>/solves", methods=["GET"])
def get_user_solves(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    query = db.select(Solve).where(Solve.user_id == user_id).order_by(Solve.id.desc())
    solves = db.session.scalars(query).all()
    return jsonify([s.to_dict() for s in solves]), 200


# UPDATE: Aggiorna la penalità ("OK", "+2", "DNF") di un tempo
@app.route("/api/solves/<int:solve_id>", methods=["PATCH"])
def update_solve(solve_id):
    solve = db.session.get(Solve, solve_id)
    if not solve:
        return jsonify({"error": "Solve not found"}), 404

    data = request.get_json() or {}
    penalty = data.get("penalty")
    if penalty not in ("OK", "+2", "DNF"):
        return jsonify({"error": "Invalid penalty (use OK, +2, or DNF)"}), 400

    solve.penalty = penalty
    db.session.commit()
    return jsonify(solve.to_dict()), 200


# DELETE: Elimina un singolo tempo
@app.route("/api/solves/<int:solve_id>", methods=["DELETE"])
def delete_solve(solve_id):
    solve = db.session.get(Solve, solve_id)
    if not solve:
        return jsonify({"error": "Solve not found"}), 404

    db.session.delete(solve)
    db.session.commit()
    return jsonify({"message": "Solve deleted"}), 200

# DELETE ACCOUNT: Elimina l'utente e a cascata tutti i suoi tempi
@app.route("/api/users/<int:user_id>", methods=["DELETE"])
def delete_user(user_id):
    user = db.session.get(User, user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    db.session.delete(user)
    db.session.commit()
    return jsonify({"message": "Account and all associated solves deleted"}), 200



if __name__ == "__main__":
    app.run(debug=True, port=5000)