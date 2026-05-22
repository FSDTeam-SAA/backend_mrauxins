const socket = io("http://localhost:3001");

// Elements
const loginDiv = document.getElementById("login");
const chatDiv = document.getElementById("chat");
const messagesDiv = document.getElementById("messages");
const userIdInput = document.getElementById("userId");
const chatWithInput = document.getElementById("chatWith");
const messageInput = document.getElementById("messageInput");
const startChatButton = document.getElementById("startChat");
const sendMessageButton = document.getElementById("sendMessage");

let chatId = null; // Will hold the chat ID after starting a chat




// Start chat on button click
startChatButton.onclick = async () => {
    const userId = userIdInput.value;
    const chatWith = chatWithInput.value;
  
    if (!userId || !chatWith) {
      alert("Please enter both User IDs");
      return;
    }
  
    // Call the backend to get or create a chat
    const response = await fetch("http://localhost:3001/api/v1/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ senderId: userId, receiverId: chatWith }),
    });
  
    const data = await response.json();
    chatId = data._id; // Store the chat ID
  
    // Join the chat room
    socket.emit("joinChat", chatId);
  
    // Switch to chat interface
    loginDiv.style.display = "none";
    chatDiv.style.display = "block";
  
    // Fetch and display messages
    fetchMessages(chatId);
  };
  
  // Fetch messages for the chat
  const fetchMessages = async (chatId) => {
    const response = await fetch(`http://localhost:3001/api/v1/chat/messages/${chatId}`);
    const messages = await response.json();
  
    messagesDiv.innerHTML = ""; // Clear previous messages
    messages.forEach((msg) => {
      displayMessage(msg.sender, msg.content);
    });
  };
  
  // Display a message in the chat
  const displayMessage = (senderId, content) => {
    const messageEl = document.createElement("div");
    messageEl.textContent = `${senderId}: ${content}`;
    messagesDiv.appendChild(messageEl);
  };
  
  // Send a message
  sendMessageButton.onclick = () => {
    const content = messageInput.value;
    const senderId = userIdInput.value;
  
    if (!content) return;
  
    // Emit message via Socket.IO
    socket.emit("sendMessage", { chatId, senderId, content });
  
    // Optimistically add the message to the UI
    displayMessage(senderId, content);
    messageInput.value = ""; // Clear input
  };
  
  // Listen for incoming messages
  socket.on("receiveMessage", (message) => {
    console.log("++++++++ received message ++++++++++", message)
    displayMessage(message.sender, message.content);
  });
