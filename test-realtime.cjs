const { io } = require("socket.io-client");

const URL = "http://localhost:3004/messages";

const u1 = io(URL, {
  auth: { userId: "u1" },
});

const u2 = io(URL, {
  auth: { userId: "u2" },
});

let u1Received = false;
let u2Received = false;

function finishIfComplete() {
  if (u1Received && u2Received) {
    console.log("\n=================================");
    console.log("✅ TEST TEMPS RÉEL RÉUSSI");
    console.log("u1 et u2 ont reçu le message.");
    console.log("=================================\n");

    u1.disconnect();
    u2.disconnect();

    process.exit(0);
  }
}

u1.on("connect", () => {
  console.log("✅ u1 connecté :", u1.id);
});

u2.on("connect", () => {
  console.log("✅ u2 connecté :", u2.id);

  setTimeout(() => {
    console.log("\n📤 u1 envoie un DM à u2...");

    u1.emit("private-message.send", {
      recipientId: "u2",
      content: "Test Redis + Socket.IO",
    });
  }, 500);
});

u1.on("private-message.created", (message) => {
  console.log("\n📩 u1 a reçu private-message.created");
  console.log(message);

  if (
    message.senderId === "u1" &&
    message.recipientId === "u2" &&
    message.content === "Test Redis + Socket.IO"
  ) {
    u1Received = true;
    finishIfComplete();
  }
});

u2.on("private-message.created", (message) => {
  console.log("\n📩 u2 a reçu private-message.created");
  console.log(message);

  if (
    message.senderId === "u1" &&
    message.recipientId === "u2" &&
    message.content === "Test Redis + Socket.IO"
  ) {
    u2Received = true;
    finishIfComplete();
  }
});

u1.on("connect_error", (error) => {
  console.error("❌ Erreur connexion u1 :", error.message);
});

u2.on("connect_error", (error) => {
  console.error("❌ Erreur connexion u2 :", error.message);
});

setTimeout(() => {
  console.error("\n❌ TIMEOUT : le message n'a pas été reçu par les deux clients.");

  u1.disconnect();
  u2.disconnect();

  process.exit(1);
}, 10000);