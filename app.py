from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
import os
import sqlite3
import json
from datetime import datetime

# Load environment variables
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Google API key
google_api_key = os.getenv('GOOGLE_API_KEY')
if not google_api_key:
    print("Warning: GOOGLE_API_KEY not found in .env file")

# Configure generative AI
genai.configure(api_key=google_api_key)

# Create the model
model = genai.GenerativeModel('gemini-2.0-flash-exp')

# Database setup
DB_PATH = 'chat_history.db'

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS conversations
                 (id INTEGER PRIMARY KEY AUTOINCREMENT,
                  session_id TEXT,
                  role TEXT,
                  message TEXT,
                  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    conn.commit()
    conn.close()

# Initialize database
init_db()

@app.route('/')
def index():
    return app.send_static_file('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        # Save user message to database
        save_message(session_id, 'user', user_message)

        # Generate response with Google Gemini
        response = model.generate_content(user_message)
        bot_response = response.text.strip()

        # Save bot response to database
        save_message(session_id, 'bot', bot_response)

        return jsonify({'response': bot_response})

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        # Save user message to database
        save_message(session_id, 'user', user_message)

        def generate():
            try:
                # Generate streaming response
                response = model.generate_content(
                    user_message,
                    stream=True
                )
                
                full_response = ""
                for chunk in response:
                    if chunk.text:
                        full_response += chunk.text
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"
                
                # Save complete bot response to database
                save_message(session_id, 'bot', full_response)
                yield f"data: {json.dumps({'done': True})}\n\n"
                
            except Exception as e:
                print(f"Streaming error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'
            }
        )

    except Exception as e:
        print(f"Error: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/history', methods=['GET'])
def get_history():
    try:
        session_id = request.args.get('session_id', 'default')
        limit = request.args.get('limit', 50, type=int)
        
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('''SELECT role, message, timestamp FROM conversations 
                     WHERE session_id = ? 
                     ORDER BY timestamp DESC LIMIT ?''', (session_id, limit))
        
        rows = c.fetchall()
        conn.close()
        
        history = [{'role': row[0], 'message': row[1], 'timestamp': row[2]} 
                   for row in reversed(rows)]
        
        return jsonify({'history': history})
    
    except Exception as e:
        print(f"Error fetching history: {e}")
        return jsonify({'error': 'Failed to fetch history'}), 500

@app.route('/history/sessions', methods=['GET'])
def get_sessions():
    try:
        limit = request.args.get('limit', 50, type=int)

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Get distinct sessions with their latest message timestamp and first message as title
        c.execute('''
            SELECT
                session_id,
                MAX(timestamp) as last_message_time,
                (SELECT message FROM conversations c2
                 WHERE c2.session_id = c1.session_id AND c2.role = 'user'
                 ORDER BY timestamp ASC LIMIT 1) as title
            FROM conversations c1
            GROUP BY session_id
            ORDER BY last_message_time DESC
            LIMIT ?
        ''', (limit,))

        rows = c.fetchall()
        conn.close()

        sessions = [{'id': row[0], 'last_message_time': row[1], 'title': row[2][:50] + '...' if row[2] and len(row[2]) > 50 else row[2] or 'Untitled Chat'}
                    for row in rows]

        return jsonify({'sessions': sessions})

    except Exception as e:
        print(f"Error fetching sessions: {e}")
        return jsonify({'error': 'Failed to fetch sessions'}), 500

@app.route('/history/clear', methods=['POST'])
def clear_history():
    try:
        data = request.get_json()
        session_id = data.get('session_id', 'default')

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('DELETE FROM conversations WHERE session_id = ?', (session_id,))
        conn.commit()
        conn.close()

        return jsonify({'success': True})

    except Exception as e:
        print(f"Error clearing history: {e}")
        return jsonify({'error': 'Failed to clear history'}), 500

def save_message(session_id, role, message):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('INSERT INTO conversations (session_id, role, message) VALUES (?, ?, ?)',
                  (session_id, role, message))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving message: {e}")

if __name__ == '__main__':
    app.run(debug=True)
