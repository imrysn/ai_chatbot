"""
PirizGPT AI Chatbot Backend

A Flask-based chatbot application using Google's Gemini AI for conversational responses.
Features streaming chat, persistent chat history, and RESTful API endpoints.
"""

from flask import Flask, request, jsonify, Response, stream_with_context
from flask_cors import CORS
from dotenv import load_dotenv
import google.generativeai as genai
import os
import sqlite3
import json
from datetime import datetime

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing for all routes

# Retrieve Google API key from environment variables
google_api_key = os.getenv('GOOGLE_API_KEY')
if not google_api_key:
    print("Warning: GOOGLE_API_KEY not found in .env file")

# Configure Google Generative AI with API key
genai.configure(api_key=google_api_key)

# Initialize Gemini AI model for conversational responses
model = genai.GenerativeModel('gemini-2.0-flash-exp')

# Database configuration
DB_PATH = 'chat_history.db'

def init_db():
    """
    Initialize the SQLite database and create conversations table if it doesn't exist.

    Creates a table to store chat messages with session tracking and timestamps.
    """
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

# Initialize database on application startup
init_db()

@app.route('/')
def index():
    """
    Serve the main application HTML page.

    Returns:
        Response: The static index.html file
    """
    return app.send_static_file('index.html')

@app.route('/chat', methods=['POST'])
def chat():
    """
    Handle non-streaming chat requests.

    Receives a JSON payload with user message and session ID, generates AI response
    using Google Gemini, and stores conversation history in database.

    Request JSON:
        {
            "message": str,  # User message (required)
            "session_id": str  # Chat session identifier (optional, default: 'default')
        }

    Returns:
        JSON response with AI generated response or error message
    """
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        # Store user message in database for conversation history
        save_message(session_id, 'user', user_message)

        # Generate AI response using Google Gemini model
        response = model.generate_content(user_message)
        bot_response = response.text.strip()

        # Store AI response in database
        save_message(session_id, 'bot', bot_response)

        return jsonify({'response': bot_response})

    except Exception as e:
        print(f"Error in chat endpoint: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/chat/stream', methods=['POST'])
def chat_stream():
    """
    Handle streaming chat requests for real-time AI responses.

    Uses Server-Sent Events (SSE) to stream AI response incrementally,
    providing a better user experience with immediate feedback.

    Request JSON:
        {
            "message": str,  # User message (required)
            "session_id": str  # Chat session identifier (optional, default: 'default')
        }

    Yields:
        SSE formatted data with streaming text chunks and completion signal
    """
    try:
        data = request.get_json()
        user_message = data.get('message', '')
        session_id = data.get('session_id', 'default')

        if not user_message:
            return jsonify({'error': 'Message is required'}), 400

        # Store user message in database before generating response
        save_message(session_id, 'user', user_message)

        def generate():
            """Generator function for streaming AI response."""
            try:
                # Generate streaming response from Gemini AI
                response = model.generate_content(user_message, stream=True)

                full_response = ""
                # Stream each text chunk as it arrives
                for chunk in response:
                    if chunk.text:
                        full_response += chunk.text
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"

                # Save complete response to database and signal completion
                save_message(session_id, 'bot', full_response)
                yield f"data: {json.dumps({'done': True})}\n\n"

            except Exception as e:
                print(f"Streaming AI error: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return Response(
            stream_with_context(generate()),
            mimetype='text/event-stream',
            headers={
                'Cache-Control': 'no-cache',
                'X-Accel-Buffering': 'no'  # Disable nginx buffering for immediate streaming
            }
        )

    except Exception as e:
        print(f"Error in streaming endpoint: {e}")
        return jsonify({'error': 'Internal server error'}), 500

@app.route('/history', methods=['GET'])
def get_history():
    """
    Retrieve chat history for a specific session.

    Query parameters:
        session_id (str): Chat session identifier (default: 'default')
        limit (int): Maximum number of messages to return (default: 50)

    Returns:
        JSON: Array of message objects with role, message text, and timestamp
        Response format: {'history': [{'role': str, 'message': str, 'timestamp': str}]}
    """
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

        # Reverse to show chronological order (oldest first)
        history = [{'role': row[0], 'message': row[1], 'timestamp': row[2]}
                   for row in reversed(rows)]

        return jsonify({'history': history})

    except Exception as e:
        print(f"Error fetching chat history: {e}")
        return jsonify({'error': 'Failed to fetch history'}), 500

@app.route('/history/sessions', methods=['GET'])
def get_sessions():
    """
    Retrieve list of all chat sessions with metadata.

    For each session, returns the session ID, last activity timestamp,
    and the first user message as the session title.

    Query parameters:
        limit (int): Maximum number of sessions to return (default: 50)

    Returns:
        JSON: Array of session objects showing recent chat sessions
        Response format: {'sessions': [{'id': str, 'last_message_time': str, 'title': str}]}
    """
    try:
        limit = request.args.get('limit', 50, type=int)

        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        # Get distinct sessions with their latest message timestamp and first message as title
        # Subquery gets the first user message for each session as the title
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

        # Format sessions with truncated titles
        sessions = [{'id': row[0], 'last_message_time': row[1], 'title': row[2][:50] + '...' if row[2] and len(row[2]) > 50 else row[2] or 'Untitled Chat'}
                    for row in rows]

        return jsonify({'sessions': sessions})

    except Exception as e:
        print(f"Error fetching chat sessions: {e}")
        return jsonify({'error': 'Failed to fetch sessions'}), 500

@app.route('/history/clear', methods=['POST'])
def clear_history():
    """
    Clear all messages for a specific chat session.

    Request JSON:
        {"session_id": str}  # Session to clear (optional, default: 'default')

    Returns:
        JSON: Success confirmation
    """
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
        print(f"Error clearing chat history: {e}")
        return jsonify({'error': 'Failed to clear history'}), 500

def save_message(session_id, role, message):
    """
    Save a chat message to the database.

    Args:
        session_id (str): Unique identifier for the chat session
        role (str): Role of the message sender ('user' or 'bot')
        message (str): The actual message text

    This function stores conversation history persistently in SQLite database
    with automatic timestamps via the database default.
    """
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute('INSERT INTO conversations (session_id, role, message) VALUES (?, ?, ?)',
                  (session_id, role, message))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error saving message to database: {e}")

if __name__ == '__main__':
    app.run(debug=True)
