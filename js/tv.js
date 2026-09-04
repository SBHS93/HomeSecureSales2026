console.log("TV Mode Loaded");

document.body.style.cursor = "none";

setInterval(() => {
    console.log("TV Refresh");
    location.reload();
}, 15000);

document.addEventListener("DOMContentLoaded", () => {
    document.body.style.opacity = 0;
    setTimeout(() => {
        document.body.style.transition = "opacity 1.5s";
        document.body.style.opacity = 1;
    }, 100);
});
