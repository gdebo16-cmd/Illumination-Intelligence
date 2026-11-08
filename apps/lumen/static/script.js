

async function send() {
    const input = document.getElementById('msg');
    const message = input.value.trim();
    if (!message) return;

    // Added: Read the currently selected model tag name
    const selectedModel = document.getElementById('model-selector').value;

    const chat = document.getElementById('chat');
    const user_message = DOMPurify.sanitize(message);
    chat.innerHTML += `<div class="user"><strong>You:</strong> ${user_message}</div>`;
    input.value = '';
    chat.scrollTop = chat.scrollHeight;

    try {
        const res = await fetch('/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: message,
                model: selectedModel // Added: Send the target model identifier string
            })
        });
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Server Error');

        const html = DOMPurify.sanitize(marked.parse(data.response));
        chat.innerHTML += `<div class="bot"><strong>Bot:</strong> ${html}</div>`;

    } catch (err) {
        chat.innerHTML += `<div class="error"><strong>Error:</strong> ${err.message}</div>`;
    }
    chat.scrollTop = chat.scrollHeight;
}

async function clearChat() {
    try {
        const res = await fetch('/clear', { method: 'POST' });
        if (res.ok) {
            document.getElementById('chat').innerHTML = '';
            console.log("Memory successfully cleared.");
        }
    } catch (err) {
        console.error("Failed to clear chat context: ", err);
    }
}

fetch('/api/get_messages')
  .then(response => response.json())
  .then(data => {
    // Create the Ollama messages array
    const ollamaMessages = data.map(message => ({
      id: message.id,
      threadId: message.thread_id,
      sender: message.sender,
      content: message.content,
      createdAt: message.created_at
    }));

    // Do something with the Ollama messages array
    console.log(ollamaMessages);
  })
  .catch(error => console.error(error));

  const conversationList = document.getElementById('conversation-list');

// Function to retrieve conversation list from backend
function getConversationList() {
  fetch('/conversations')
    .then(response => response.json())
    .then(data => {
      // Clear the conversation list
      conversationList.innerHTML = '';
      // Add conversation list items
      data.conversations.forEach(conversation => {
        const conversationItem = document.createElement('li');
        conversationItem.textContent = conversation.name;
        conversationItem.addEventListener('click', () => {
          // Handle conversation click event
          selectConversation(conversation.id);
        });
        conversationList.appendChild(conversationItem);
      });
    });
}

// Function to select a conversation
function selectConversation(conversationId) {
  // Display conversation messages
  getConversationMessages(conversationId);
}

// Function to retrieve conversation messages from backend
function getConversationMessages(conversationId) {
  fetch(`/conversations/${conversationId}/messages`)
    .then(response => response.json())
    .then(data => {
      // Display conversation messages
      const conversationMessages = document.getElementById('conversation-messages');
      conversationMessages.innerHTML = '';
      data.messages.forEach(message => {
        const messageItem = document.createElement('li');
        messageItem.textContent = message.text;
        conversationMessages.appendChild(messageItem);
      });
    });
}

// Initialize conversation list
getConversationList();

const sidebar = document.getElementById('sidebar');
const button = document.getElementById('toggle-sidebar-button');

// Function to toggle the sidebar
function toggleSidebar() {
  if (sidebar.style.display === 'block') {
    sidebar.style.display = 'none';
  } else {
    sidebar.style.display = 'block';
  }
}

// Function to retrieve conversation list from backend
function getConversationList() {
  fetch('/conversations')
    .then(response => response.json())
    .then(data => {
      // Clear the conversation list
      conversationList.innerHTML = '';
      // Add conversation list items
      data.conversations.forEach(conversation => {
        const conversationItem = document.createElement('li');
        conversationItem.textContent = conversation.name;
        conversationItem.addEventListener('click', () => {
          // Handle conversation click event
          selectConversation(conversation.id);
        });
        conversationList.appendChild(conversationItem);
      });
    });
}

// Function to select a conversation
function selectConversation(conversationId) {
  // Display conversation messages
  getConversationMessages(conversationId);
}

// Function to retrieve conversation messages from backend
function getConversationMessages(conversationId) {
  fetch(`/conversations/${conversationId}/messages`)
    .then(response => response.json())
    .then(data => {
      // Display conversation messages
      const conversationMessages = document.getElementById('conversation-messages');
      conversationMessages.innerHTML = '';
      data.messages.forEach(message => {
        const messageItem = document.createElement('li');
        messageItem.textContent = message.text;
        conversationMessages.appendChild(messageItem);
      });
    });
}

// Function to toggle the conversation list
function toggleConversationList() {
    if (document.getElementById('conversation-list').style.display === 'block') {
      document.getElementById('conversation-list').style.display = 'none';
    } else {
      document.getElementById('conversation-list').style.display = 'block';
    }
  }
  
  // Call the function when a button is clicked
  document.getElementById('toggle-button').addEventListener('click', toggleConversationList);
  toggleConversationList();

// Mobile keyboard: shrink the page to the visible area so chat bubbles stay above the input
if (window.visualViewport) {
    const vv = window.visualViewport;
    const root = document.documentElement;
    const chatBox = document.getElementById('chat');
    function fitToKeyboard() {
        const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
        root.style.setProperty('--app-height', vv.height + 'px');
        root.style.setProperty('--kb-offset', keyboard + 'px');
        window.scrollTo(0, 0);
        chatBox.scrollTop = chatBox.scrollHeight;
    }
    vv.addEventListener('resize', fitToKeyboard);
    vv.addEventListener('scroll', fitToKeyboard);
}