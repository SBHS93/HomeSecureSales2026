import { db } from "./firebase-init.js";
import {
    collection,
    addDoc,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   HANDLE SALE SUBMISSION
============================================================ */
document.getElementById("submit-sale").addEventListener("click", async () => {

    const agent = document.getElementById("agent").value;
    const upfront = parseFloat(document.getElementById("upfront").value || 0);
    const monitoring = parseFloat(document.getElementById("monitoring").value || 0);
    const date = document.getElementById("date").value;

    if (!agent || !date) {
        alert("Please fill in all required fields.");
        return;
    }

    try {
        await addDoc(collection(db, "sales"), {
            agent,
            upfront,
            monitoring,
            date,
            timestamp: serverTimestamp()
        });

        // Success message
        const msg = document.getElementById("success-message");
        msg.style.display = "block";
        msg.textContent = "Sale Saved Successfully 🎉";

        setTimeout(() => {
            msg.style.display = "none";
        }, 3000);

        // Reset fields
        document.getElementById("agent").value = "";
        document.getElementById("upfront").value = "";
        document.getElementById("monitoring").value = "";
        document.getElementById("date").value = "";

    } catch (err) {
        console.error("Error adding sale:", err);
        alert("Error saving sale. Check console.");
    }
});
