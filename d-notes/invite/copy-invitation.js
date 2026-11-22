const button = document.querySelector("#copy-invitation");
const status = document.querySelector("#copy-status");

button.addEventListener("click", async () => {
  if (!/^#[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(window.location.hash)) {
    status.textContent = "Open the full invitation link or copy it from the invitation message.";
    return;
  }
  try {
    await navigator.clipboard.writeText(window.location.href);
    status.textContent = "Invitation copied.";
  } catch {
    status.textContent = "Copy the link from your browser’s address bar.";
  }
});
