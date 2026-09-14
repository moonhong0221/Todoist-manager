import os
from datetime import date, datetime, timezone
from functools import wraps

from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for
from flask_sqlalchemy import SQLAlchemy

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET_KEY", "dev-secret-change-me")
app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///tasks.db"
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False

db = SQLAlchemy(app)

# ---------------------------------------------------------------------------
# 구글 OAuth 설정
# ---------------------------------------------------------------------------
oauth = OAuth(app)
google = oauth.register(
    name="google",
    client_id=os.environ.get("GOOGLE_CLIENT_ID"),
    client_secret=os.environ.get("GOOGLE_CLIENT_SECRET"),
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


# ---------------------------------------------------------------------------
# 모델
# ---------------------------------------------------------------------------
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    google_sub = db.Column(db.String(255), unique=True, nullable=False)  # 구글 고유 사용자 ID
    email = db.Column(db.String(255), nullable=False)
    name = db.Column(db.String(255), nullable=True)
    picture = db.Column(db.String(500), nullable=True)

    tasks = db.relationship("Task", backref="owner", lazy=True, cascade="all, delete-orphan")

    def to_dict(self):
        return {"id": self.id, "email": self.email, "name": self.name, "picture": self.picture}


class Task(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    is_done = db.Column(db.Boolean, nullable=False, default=False)
    priority = db.Column(db.String(10), nullable=False, default="medium")  # low / medium / high
    due_date = db.Column(db.Date, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "is_done": self.is_done,
            "priority": self.priority,
            "due_date": self.due_date.isoformat() if self.due_date else None,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# 로그인 보호 데코레이터
# ---------------------------------------------------------------------------
def login_required(view_func):
    @wraps(view_func)
    def wrapped(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "login required"}), 401
            return redirect(url_for("login"))
        return view_func(*args, **kwargs)

    return wrapped


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    return User.query.get(user_id)


# ---------------------------------------------------------------------------
# 인증 라우트
# ---------------------------------------------------------------------------
@app.route("/login")
def login():
    if "user_id" in session:
        return redirect(url_for("index"))
    redirect_uri = url_for("auth_callback", _external=True)
    return google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def auth_callback():
    token = google.authorize_access_token()
    userinfo = token.get("userinfo") or google.parse_id_token(token)

    google_sub = userinfo["sub"]
    email = userinfo.get("email")
    name = userinfo.get("name")
    picture = userinfo.get("picture")

    user = User.query.filter_by(google_sub=google_sub).first()
    if user is None:
        user = User(google_sub=google_sub, email=email, name=name, picture=picture)
        db.session.add(user)
    else:
        user.email = email
        user.name = name
        user.picture = picture
    db.session.commit()

    session["user_id"] = user.id
    return redirect(url_for("index"))


@app.route("/logout")
def logout():
    session.pop("user_id", None)
    return redirect(url_for("index"))


# ---------------------------------------------------------------------------
# 페이지
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return render_template("index.html", user=current_user())


# ---------------------------------------------------------------------------
# API (로그인한 사용자의 할 일만 조회/수정 가능)
# ---------------------------------------------------------------------------
def _parse_due_date(value):
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


@app.route("/api/tasks", methods=["GET"])
@login_required
def get_tasks():
    page = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 5, type=int)
    status = request.args.get("status", "all")
    q = (request.args.get("q") or "").strip()

    base = Task.query.filter_by(user_id=session["user_id"])

    query = base.order_by(Task.is_done.asc(), Task.due_date.is_(None), Task.due_date.asc(), Task.created_at.desc())
    if status == "active":
        query = query.filter_by(is_done=False)
    elif status == "done":
        query = query.filter_by(is_done=True)
    if q:
        query = query.filter(Task.title.ilike(f"%{q}%"))

    pagination = query.paginate(page=page, per_page=per_page, error_out=False)

    counts = {
        "all": base.count(),
        "active": base.filter_by(is_done=False).count(),
        "done": base.filter_by(is_done=True).count(),
    }

    return jsonify({
        "tasks": [task.to_dict() for task in pagination.items],
        "page": pagination.page,
        "per_page": per_page,
        "total": pagination.total,
        "total_pages": pagination.pages,
        "counts": counts,
    })


@app.route("/api/tasks", methods=["POST"])
@login_required
def create_task():
    data = request.get_json(silent=True) or {}
    title = (data.get("title") or "").strip()
    if not title:
        return jsonify({"error": "title is required"}), 400

    priority = data.get("priority") or "medium"
    if priority not in ("low", "medium", "high"):
        priority = "medium"

    task = Task(
        title=title,
        user_id=session["user_id"],
        priority=priority,
        due_date=_parse_due_date(data.get("due_date")),
    )
    db.session.add(task)
    db.session.commit()
    return jsonify(task.to_dict()), 201


@app.route("/api/tasks/<int:task_id>", methods=["PATCH"])
@login_required
def update_task(task_id):
    task = Task.query.filter_by(id=task_id, user_id=session["user_id"]).first_or_404()
    data = request.get_json(silent=True) or {}

    if "title" in data:
        title = (data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "title is required"}), 400
        task.title = title

    if "is_done" in data:
        task.is_done = bool(data.get("is_done"))

    if "priority" in data:
        priority = data.get("priority") or "medium"
        if priority not in ("low", "medium", "high"):
            priority = "medium"
        task.priority = priority

    if "due_date" in data:
        task.due_date = _parse_due_date(data.get("due_date"))

    db.session.commit()
    return jsonify(task.to_dict())


@app.route("/api/tasks/<int:task_id>", methods=["DELETE"])
@login_required
def delete_task(task_id):
    task = Task.query.filter_by(id=task_id, user_id=session["user_id"]).first_or_404()
    db.session.delete(task)
    db.session.commit()
    return "", 204


@app.route("/api/tasks/completed", methods=["DELETE"])
@login_required
def clear_completed():
    Task.query.filter_by(user_id=session["user_id"], is_done=True).delete()
    db.session.commit()
    return "", 204


if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(debug=True)
