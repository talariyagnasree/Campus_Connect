"""CampusConnect backend: Flask REST API + SQLite. Run: python app.py"""
import json, os, re, secrets, sqlite3
from datetime import date, timedelta
from flask import Flask, g, jsonify, request, send_from_directory

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "campusconnect.db")
FRONTEND = BASE
app = Flask(__name__, static_folder=None)

# ---------- Database ----------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA foreign_keys = ON")
    return g.db

@app.teardown_appcontext
def close_db(_):
    conn = g.pop("db", None)
    if conn:
        conn.close()

def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(open(os.path.join(BASE, "schema.sql")).read())
    if conn.execute("SELECT COUNT(*) FROM events").fetchone()[0] == 0:
        for e in json.load(open(os.path.join(BASE, "seed_events.json"))):
            when = (date.today() + timedelta(days=e["day_offset"])).isoformat()
            conn.execute(
                "INSERT INTO events (title,category,event_date,time,venue,club,seats,taken,description) VALUES (?,?,?,?,?,?,?,?,?)",
                (e["title"], e["category"], when, e["time"], e["venue"], e["club"], e["seats"], e["taken"], e["description"]))
    conn.commit(); conn.close()

EVENT_SQL = """SELECT e.*, e.seats - e.taken - (SELECT COUNT(*) FROM registrations r WHERE r.event_id = e.id) AS seats_left
               FROM events e"""

def event_json(row):
    d = dict(row)  # frontend-friendly names
    return {"id": d["id"], "title": d["title"], "cat": d["category"], "date": d["event_date"], "time": d["time"],
            "venue": d["venue"], "club": d["club"], "seats": d["seats"], "taken": d["taken"],
            "desc": d["description"], "left": d["seats_left"]}

def error(msg, code=400):
    return jsonify({"error": msg}), code

# ---------- Events ----------
@app.get("/api/events")
def list_events():
    rows = db().execute(EVENT_SQL + " ORDER BY e.event_date, e.id").fetchall()
    return jsonify([event_json(r) for r in rows])

@app.get("/api/events/<int:event_id>")
def get_event(event_id):
    row = db().execute(EVENT_SQL + " WHERE e.id = ?", (event_id,)).fetchone()
    return jsonify(event_json(row)) if row else error("Event not found", 404)

# ---------- Registrations ----------
REG_COLS = "id, event_id, name, email, roll_number, code, created_at"

@app.post("/api/registrations")
def register():
    d = request.get_json(silent=True) or {}
    sid, eid = str(d.get("student_id", "")).strip(), d.get("event_id")
    name, email, roll = (str(d.get(k, "")).strip() for k in ("name", "email", "roll_number"))
    if not sid or not isinstance(eid, int): return error("student_id and event_id are required")
    if len(name) < 2: return error("Please enter your full name")
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email): return error("Please enter a valid email")
    if len(roll) < 3: return error("Please enter your roll number")
    conn = db()
    if not conn.execute("SELECT 1 FROM events WHERE id = ?", (eid,)).fetchone(): return error("Event not found", 404)
    code = "CC-" + secrets.token_hex(3).upper()
    try:
        # Single atomic statement: inserts only if a seat is still free.
        cur = conn.execute(
            """INSERT INTO registrations (student_id,event_id,name,email,roll_number,code)
               SELECT ?,?,?,?,?,? WHERE (SELECT seats - taken - (SELECT COUNT(*) FROM registrations WHERE event_id = ?)
                                         FROM events WHERE id = ?) > 0""",
            (sid, eid, name, email, roll, code, eid, eid))
        conn.commit()
    except sqlite3.IntegrityError:
        return error("You're already registered for this event", 409)
    if cur.rowcount == 0: return error("Sorry, this event is full", 409)
    row = conn.execute(f"SELECT {REG_COLS} FROM registrations WHERE id = ?", (cur.lastrowid,)).fetchone()
    return jsonify(dict(row)), 201

@app.get("/api/registrations/<student_id>")
def my_registrations(student_id):
    rows = db().execute(f"SELECT {REG_COLS} FROM registrations WHERE student_id = ? ORDER BY created_at", (student_id,)).fetchall()
    return jsonify([dict(r) for r in rows])

@app.delete("/api/registrations/<int:reg_id>")
def cancel_registration(reg_id):
    cur = db().execute("DELETE FROM registrations WHERE id = ? AND student_id = ?", (reg_id, request.args.get("student_id", "")))
    db().commit()
    return ("", 204) if cur.rowcount else error("Registration not found", 404)

# ---------- Saved events ----------
@app.get("/api/saved/<student_id>")
def list_saved(student_id):
    rows = db().execute("SELECT event_id FROM saved_events WHERE student_id = ?", (student_id,)).fetchall()
    return jsonify([r["event_id"] for r in rows])

@app.post("/api/saved")
def save_event():
    d = request.get_json(silent=True) or {}
    try:
        db().execute("INSERT OR IGNORE INTO saved_events (student_id,event_id) VALUES (?,?)", (str(d.get("student_id", "")), d.get("event_id")))
        db().commit()
    except sqlite3.IntegrityError:
        return error("Event not found", 404)
    return jsonify({"saved": True}), 201

@app.delete("/api/saved/<student_id>/<int:event_id>")
def unsave_event(student_id, event_id):
    db().execute("DELETE FROM saved_events WHERE student_id = ? AND event_id = ?", (student_id, event_id))
    db().commit()
    return "", 204

# ---------- Frontend ----------
@app.get("/")
def index():
    return send_from_directory(FRONTEND, "index.html")

@app.get("/<path:filename>")
def assets(filename):
    return send_from_directory(FRONTEND, filename)

init_db()
if __name__ == "__main__":
    app.run(debug=True)
