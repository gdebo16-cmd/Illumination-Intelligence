import sqlite3

# Connect to the database
conn = sqlite3.connect('database.db')
cursor = conn.cursor()

# Function to save a conversation
def save_conversation(name, description):
    # Insert a new row into the threads table
    cursor.execute("INSERT INTO threads (title, created_at) VALUES (?, ?)", (name, datetime.now().isoformat()))
    conversation_id = cursor.lastrowid

    # Insert all the messages for that conversation into the messages table
    for message in messages:
        cursor.execute("INSERT INTO messages (thread_id, role, content, created_at) VALUES (?, ?, ?, ?)", (conversation_id, message['role'], message['content'], datetime.now().isoformat()))

    # Commit the changes
    conn.commit()

# Function to recall a conversation
def recall_conversation(conversation_id):
    # Retrieve all the messages for that conversation from the messages table
    cursor.execute("SELECT * FROM messages WHERE thread_id = ?", (conversation_id,))
    messages = cursor.fetchall()

    # Return the messages
    return messages

# Call the functions
save_conversation('My Conversation', 'This is my conversation')
conversation_id = cursor.lastrowid
messages = recall_conversation(conversation_id)
print(messages)
