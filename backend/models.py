from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import ForeignKey, String, Integer, DateTime
from sqlalchemy.orm import Mapped, mapped_column

# Istanza globale di SQLAlchemy (come nella Slide 6)
db = SQLAlchemy()


class User(db.Model):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    email: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(256), nullable=False)

    # Relazione 1-a-molti: un utente ha molti tempi (Slide 3 e 6)
    solves: Mapped[list["Solve"]] = db.relationship(
        back_populates="user", cascade="all, delete-orphan"
    )

    def to_dict(self):
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
        }


class Solve(db.Model):
    __tablename__ = "solves"

    id: Mapped[int] = mapped_column(primary_key=True)
    time_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    scramble: Mapped[str] = mapped_column(String(255), nullable=False)
    penalty: Mapped[str] = mapped_column(String(10), default="OK", nullable=False)  # "OK", "+2", "DNF"
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False
    )

    # Chiave esterna verso users.id (Slide 3)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    user: Mapped["User"] = db.relationship(back_populates="solves")

    def to_dict(self):
        return {
            "id": self.id,
            "time_ms": self.time_ms,
            "scramble": self.scramble,
            "penalty": self.penalty,
            "created_at": self.created_at.isoformat(),
            "user_id": self.user_id,
        }