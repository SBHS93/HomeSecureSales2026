import { db } from "./firebase-init.js";
import {
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    getDoc,
    setDoc,
    query,
    orderBy,
    where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

/* ============================================================
   SIMPLE ADMIN LOGIN
============================================================ */
const PASSWORD = "HomeSecure2025";

document.getElementById("admin-login-btn").addEventListener("click", () => {
    const input = document.getElementById("admin-password").value.trim();
    if (input === PASSWORD) {
        document.getElementById("password-screen").style.display = "none";
        document.getElementById("admin-content").style.display = "block";
        loadSales();
        loadTargets();
    } else {
        alert("Incorrect password");
    }
});

/* ============================================================
   LOAD SALES INTO ADMIN TABLE
============================================================ */
function loadSales() {
    const tbody = document.getElementById("admin-sales-body");

    // Only load/display the last 5 weeks of sales to keep the admin page fast.
    // This does not delete older sales from Firebase.
    const fiveWeeksAgo = new Date();
    fiveWeeksAgo.setDate(fiveWeeksAgo.getDate() - 35);
    const cutoffDate = fiveWeeksAgo.toISOString().split("T")[0];

    const q = query(
        collection(db, "sales"),
        where("date", ">=", cutoffDate),
        orderBy("date", "desc")
    );

    onSnapshot(q, (snapshot) => {
        const rows = [];

        snapshot.forEach((docSnap) => {
            const s = docSnap.data();
            const id = docSnap.id;

            rows.push(`
                <tr>
                    <td>${s.agent || ""}</td>
                    <td>€${Number(s.upfront || 0).toFixed(2)}</td>
                    <td>€${Number(s.monitoring || 0).toFixed(2)}</td>
                    <td>${s.date || ""}</td>
                    <td>
                        <button class="delete-btn" onclick="deleteSale('${id}')">X</button>
                    </td>
                </tr>
            `);
        });

        tbody.innerHTML = rows.join("");
    });
}

// Delete function exposed to window
window.deleteSale = async function (id) {
    if (!confirm("Delete this sale?")) return;
    await deleteDoc(doc(db, "sales", id));
};

/* ============================================================
   TARGET MANAGEMENT
============================================================ */
async function loadTargets() {
    const ref = doc(db, "targets", "main");
    const snap = await getDoc(ref);

    if (snap.exists()) {
        const t = snap.data();

        document.getElementById("target-daily").value = t.daily;
        document.getElementById("target-weekly").value = t.weekly;
        document.getElementById("target-monthly").value = t.monthly;
        document.getElementById("target-avg-revenue").value = t.avgRevenue;
        document.getElementById("target-avg-upfront").value = t.avgUpfront;
    }
}

document.getElementById("save-targets").addEventListener("click", async () => {
    const daily = Number(document.getElementById("target-daily").value);
    const weekly = Number(document.getElementById("target-weekly").value);
    const monthly = Number(document.getElementById("target-monthly").value);
    const avgRevenue = Number(document.getElementById("target-avg-revenue").value);
    const avgUpfront = Number(document.getElementById("target-avg-upfront").value);

    if ([daily, weekly, monthly, avgRevenue, avgUpfront].some(isNaN)) {
        alert("Please enter valid numbers.");
        return;
    }

    await setDoc(doc(db, "targets", "main"), {
        daily,
        weekly,
        monthly,
        avgRevenue,
        avgUpfront
    });

    alert("Targets updated successfully!");
});