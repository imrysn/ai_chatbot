const chatMessages = document.getElementById('chat-messages');
const messageInput = document.getElementById('message-input');
const sendButton = document.getElementById('send-button');
const micButton = document.getElementById('mic-button');

// Sidebar elements
const sidebar = document.getElementById('sidebar');
const newChatBtn = document.getElementById('new-chat-btn');
const chatList = document.getElementById('chat-list');
const mainContent = document.querySelector('.main-content');

// Context menu
const contextMenu = document.getElementById('context-menu');

const suggestionPool = [
    "Tell me a fun fact",
    "Explain quantum computing",
    "Write a short poem",
    "What's the weather like today?",
    "Tell me a joke",
    "How does photosynthesis work?",
    "What are some healthy breakfast ideas?",
    "Explain the concept of recursion",
    "What's the meaning of life?",
    "Tell me about space exploration",
    "How to meditate for beginners?",
    "What's artificial intelligence?",
    "Give me cooking tips",
    "Explain blockchain technology",
    "What's your favorite color?"
];

let sessionId = 'session_' + Date.now();
let recognition = null;
let isRecording = false;
let isTTSEnabled = true;
let currentChatToDelete = null;

// Auto-resize textarea
messageInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

// Initialize speech recognition
// Check if browser supports Web Speech API (Chrome, Edge, Safari)
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    recognition = new SpeechRecognition();
    recognition.continuous = false;        // Stop after first recognition
    recognition.interimResults = false;   // Only final results, no partial transcripts
    recognition.lang = 'en-US';           // Language for recognition

    // Handle successful speech recognition
    recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;  // Get the recognized text
        messageInput.value = transcript;                     // Set input field value
        messageInput.style.height = 'auto';                 // Reset height for auto-resize
        messageInput.style.height = (messageInput.scrollHeight) + 'px';  // Auto-resize
        isRecording = false;
        micButton.classList.remove('recording');            // Update UI state
    };

    // Handle speech recognition errors
    recognition.onerror = (event) => {
        console.error('Speech recognition error:', event.error);
        isRecording = false;
        micButton.classList.remove('recording');
    };

    // Handle recognition end (either success or cancellation)
    recognition.onend = () => {
        isRecording = false;
        micButton.classList.remove('recording');
    };
} else {
    // Disable voice input if not supported
    micButton.disabled = true;
    micButton.setAttribute('data-tooltip', 'Speech recognition not supported');
}

// Load theme preference
const savedTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

// Load TTS preference
const savedTTS = localStorage.getItem('tts-enabled');
if (savedTTS !== null) {
    isTTSEnabled = savedTTS === 'true';
    updateTTSButton();
}

// Load chat history on page load
window.addEventListener('load', () => {
    // Show loading indicator while loading chat data
    const loadingIndicator = document.createElement('div');
    loadingIndicator.className = 'loading-indicator';
    loadingIndicator.innerHTML = `
        <div class="loading-spinner">
            <div class="spinner"></div>
            <div>Loading chat history...</div>
        </div>
    `;
    chatMessages.appendChild(loadingIndicator);

    loadHistory().then(() => {
        loadChatHistory().then(() => {
            // Remove loading indicator once data is loaded
            loadingIndicator.remove();
        });
    });
});

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
}

function toggleTTS() {
    isTTSEnabled = !isTTSEnabled;
    localStorage.setItem('tts-enabled', isTTSEnabled);
    updateTTSButton();
    
    if (!isTTSEnabled && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
}

function updateTTSButton() {
    const ttsToggle = document.querySelector('.tts-toggle');
    if (isTTSEnabled) {
        ttsToggle.classList.remove('disabled');
    } else {
        ttsToggle.classList.add('disabled');
    }
}

function toggleSpeechRecognition() {
    if (!recognition) {
        alert('Speech recognition is not supported in your browser.');
        return;
    }

    if (isRecording) {
        recognition.stop();
        isRecording = false;
        micButton.classList.remove('recording');
    } else {
        recognition.start();
        isRecording = true;
        micButton.classList.add('recording');
    }
}

function speak(text) {
    if (!isTTSEnabled || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.2; 
    utterance.pitch = 1.8; 
    utterance.volume = 1.0;

    // Attempt to select an Asian girl's voice (comes down to system voices)
    const voices = window.speechSynthesis.getVoices();
    // Prefer Japanese or Korean female voices, fallback to any female voice, then default
    let selectedVoice = voices.find(v => v.lang === 'ja-JP' && v.name.toLowerCase().includes('female'));
    if (!selectedVoice) selectedVoice = voices.find(v => v.lang === 'ja-JP');
    if (!selectedVoice) selectedVoice = voices.find(v => v.name.toLowerCase().includes('female') || v.name.toLowerCase().includes('girl'));
    if (!selectedVoice) selectedVoice = voices.find(v => v.lang.startsWith('en') || v.lang.startsWith('zh') || v.lang.startsWith('ko')); 
    if (!selectedVoice) selectedVoice = voices[0];

    utterance.voice = selectedVoice;

    window.speechSynthesis.speak(utterance);
}

sendButton.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

function sendSuggestion(text) {
    messageInput.value = text;
    sendMessage();
}

async function sendMessage() {
    const message = messageInput.value.trim();
    if (message === '') return;

    // Remove empty state UI when user sends first message
    const emptyState = chatMessages.querySelector('.empty-state');
    if (emptyState) {
        emptyState.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => emptyState.remove(), 300);
    }

    // Add user's message to chat UI
    addMessage('user', message);

    // Reset input field and disable controls during API call
    messageInput.value = '';
    messageInput.style.height = 'auto';
    messageInput.disabled = true;
    sendButton.disabled = true;

    // Show typing indicator while waiting for AI response
    const typingDiv = document.createElement('div');
    typingDiv.className = 'typing-indicator';
    typingDiv.innerHTML = `
        <div class="typing-indicator-dots">
            <span></span><span></span><span></span>
        </div>
    `;
    chatMessages.appendChild(typingDiv);
    scrollToBottomIfNear();

    try {
        // Send message to streaming endpoint with session ID
        const response = await fetch('/chat/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                session_id: sessionId
            }),
        });

        // Remove typing indicator once response starts
        typingDiv.remove();

        if (!response.ok) {
            throw new Error('Network response was not ok');
        }

        // Create bot message container for streaming content
        const messageDiv = document.createElement('div');
        messageDiv.className = 'message bot';
        chatMessages.appendChild(messageDiv);
        const wasNearBottom = isNearBottom(); // Track scroll position for auto-scroll

        // Set up streaming response reader
        const reader = response.body.getReader();  // Get stream reader
        const decoder = new TextDecoder();         // Decode bytes to text
        let fullText = '';                         // Accumulate complete response

        // Read streaming data in chunks
        while (true) {
            const { done, value } = await reader.read();  // Read next chunk
            if (done) break;                              // End of stream

            const chunk = decoder.decode(value);          // Decode chunk to text
            const lines = chunk.split('\n');             // SSE messages are line-separated

            for (const line of lines) {
                if (line.startsWith('data: ')) {          // Process SSE data lines
                    try {
                        const data = JSON.parse(line.slice(6));  // Parse JSON payload
                        if (data.text) {
                            // Append new text chunk and render markdown
                            fullText += data.text;
                            messageDiv.innerHTML = marked.parse(fullText);
                            // Auto-scroll if user was near bottom
                            if (wasNearBottom) {
                                chatMessages.scrollTop = chatMessages.scrollHeight;
                            }
                        } else if (data.done) {
                            // Stream complete - trigger TTS and update sidebar
                            speak(fullText);              // Speak full response
                            loadChatHistory();            // Refresh sidebar chat list
                        } else if (data.error) {
                            // Display streaming error
                            messageDiv.textContent = 'Error: ' + data.error;
                        }
                    } catch (e) {
                        console.error('Error parsing SSE data:', e);
                    }
                }
            }
        }

    } catch (error) {
        // Handle network/streaming errors
        typingDiv.remove();
        addMessage('bot', '❌ Error: Unable to fetch response. Please try again.');
        console.error('Error:', error);
    }

    // Re-enable input controls
    messageInput.disabled = false;
    sendButton.disabled = false;
}

function isNearBottom() {
    return chatMessages.scrollTop + chatMessages.clientHeight >= chatMessages.scrollHeight - 10;
}

function scrollToBottomIfNear() {
    if (isNearBottom()) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function addMessage(role, message) {
    const wasNearBottom = isNearBottom();
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${role}`;
    if (role === 'bot') {
        messageDiv.innerHTML = marked.parse(message);
    } else {
        messageDiv.textContent = message;
    }
    chatMessages.appendChild(messageDiv);
    if (wasNearBottom) {
        scrollToBottomIfNear();
    }
}

function getRandomSuggestions(count = 3) {
    const shuffled = [...suggestionPool].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, count);
}

function generateSuggestionChipsHTML(suggestions) {
    const icons = [
        'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z',
        'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
        'M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z',
        'M3 15a4 4 0 004 4h11a3 3 0 002.995-2.824L21 15v2.18a3 3 0 01-.171.923L15.5 21l-5-3-5.329 3L3 17.18V15zm15-3a1 1 0 110-2 1 1 0 010 2z',
        'M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z',
        'M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z'
    ];

    return suggestions.map((text, index) => {
        const iconPath = icons[index % icons.length];
        const escapedText = text.replace(/'/g, '\\$&');
        return `<div class="chip" onclick="sendSuggestion('${escapedText}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="${iconPath}"/>
            </svg>
            ${text}
        </div>`;
    }).join('');
}

async function loadHistory() {
    try {
        const response = await fetch(`/history?session_id=${sessionId}`);
        const data = await response.json();

        if (data.history && data.history.length > 0) {
            // Clear empty state
            const emptyState = chatMessages.querySelector('.empty-state');
            if (emptyState) {
                emptyState.remove();
            }

            // Add messages from history
            data.history.forEach(item => {
                addMessage(item.role, item.message);
            });
            // Ensure chat is scrolled to bottom after loading history
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 0);
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function toggleSidebar() {
    sidebar.classList.toggle('collapsed');
}

function startNewChat() {
    // Generate new session ID
    sessionId = 'session_' + Date.now();

    // Get random suggestions
    const randomSuggestions = getRandomSuggestions(3);
    const suggestionChipsHTML = generateSuggestionChipsHTML(randomSuggestions);

    // Clear current messages and show empty state
    chatMessages.innerHTML = `
        <div class="empty-state">
            <div class="empty-state-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                </svg>
            </div>
            <div class="empty-state-title">Start a Conversation</div>
            <div class="empty-state-text">
                Ask me anything! I'm here to help with questions, ideas, or just a friendly chat.
            </div>
            <div class="suggestion-chips">
                ${suggestionChipsHTML}
            </div>
        </div>
    `;

    // Remove active class from all chat items
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
    });

    // Reload chat history
    loadChatHistory();
}

async function loadChat(chatSessionId) {
    // Set the session ID to the selected chat
    sessionId = chatSessionId;

    // Clear current messages
    chatMessages.innerHTML = '';

    // Load the history for this session
    try {
        const response = await fetch(`/history?session_id=${sessionId}`);
        const data = await response.json();

        if (data.history && data.history.length > 0) {
            // Add messages from history
            data.history.forEach(item => {
                addMessage(item.role, item.message);
            });
            // Ensure chat is scrolled to bottom after loading history
            setTimeout(() => {
                chatMessages.scrollTop = chatMessages.scrollHeight;
            }, 0);
        } else {
            // If no messages, show empty state
            chatMessages.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
                        </svg>
                    </div>
                    <div class="empty-state-title">Start a Conversation</div>
                    <div class="empty-state-text">
                        Ask me anything! I'm here to help with questions, ideas, or just a friendly chat.
                    </div>
                </div>
            `;
        }
    } catch (error) {
        console.error('Error loading history:', error);
    }

    // Update active state in sidebar
    document.querySelectorAll('.chat-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.sessionId === chatSessionId) {
            item.classList.add('active');
        }
    });
}

async function loadChatHistory() {
    try {
        const response = await fetch('/history/sessions');
        const data = await response.json();

        chatList.innerHTML = '';

        // Add sessions from backend
        if (data.sessions && data.sessions.length > 0) {
            data.sessions.forEach(chat => {
                const isActive = chat.id === sessionId;
                const item = createChatItem(chat.id, chat.title || 'Untitled Chat', isActive);
                chatList.appendChild(item);
            });
        }
    } catch (error) {
        console.error('Error loading chat history:', error);
        chatList.innerHTML = '';
    }
}

function createChatItem(id, title, isActive) {
    const item = document.createElement('div');
    item.className = 'chat-item' + (isActive ? ' active' : '');
    item.dataset.sessionId = id;
    
    item.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
        </svg>
        <span class="chat-title">${title}</span>
        <button class="chat-menu-btn" onclick="event.stopPropagation(); showContextMenu(event, '${id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="12" cy="5" r="1"></circle>
                <circle cx="12" cy="19" r="1"></circle>
            </svg>
        </button>
    `;
    
    // Add click handler to load the chat
    item.addEventListener('click', (e) => {
        if (!e.target.closest('.chat-menu-btn')) {
            loadChat(id);
        }
    });
    
    return item;
}

function showContextMenu(event, chatId) {
    event.stopPropagation();
    
    currentChatToDelete = chatId;
    
    contextMenu.style.left = event.pageX + 'px';
    contextMenu.style.top = event.pageY + 'px';
    contextMenu.classList.add('show');
}

function showDeleteConfirmation() {
    contextMenu.classList.remove('show');
    if (!currentChatToDelete) return;
    
    const modal = document.getElementById('delete-modal');
    modal.classList.add('show');
}

function cancelDelete() {
    const modal = document.getElementById('delete-modal');
    modal.classList.remove('show');
    currentChatToDelete = null;
}

function confirmDelete() {
    const modal = document.getElementById('delete-modal');
    modal.classList.remove('show');
    deleteChat();
}

async function deleteChat() {
    if (!currentChatToDelete) return;

    try {
        const response = await fetch('/history/clear', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ session_id: currentChatToDelete }),
        });

        if (response.ok) {
            // If deleting current chat, start a new one
            if (currentChatToDelete === sessionId) {
                startNewChat();
            } else {
                // Just reload chat history
                loadChatHistory();
            }
        } else {
            alert('Failed to delete chat. Please try again.');
        }
    } catch (error) {
        console.error('Error deleting chat:', error);
        alert('Failed to delete chat. Please try again.');
    }
    
    currentChatToDelete = null;
}

// Close context menu when clicking outside
document.addEventListener('click', (e) => {
    if (!e.target.closest('.context-menu') && !e.target.closest('.chat-menu-btn')) {
        contextMenu.classList.remove('show');
    }
});

// Initialize
newChatBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startNewChat();
});

// Make sidebar header clickable to toggle
sidebar.querySelector('.sidebar-header').addEventListener('click', (e) => {
    toggleSidebar();
});

// Sidebar toggle button
document.getElementById('sidebar-toggle').addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSidebar();
});

// Prevent sidebar toggle when clicking on content area
sidebar.querySelector('.sidebar-content').addEventListener('click', (e) => {
    e.stopPropagation();
});
