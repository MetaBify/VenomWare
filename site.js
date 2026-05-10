const input = document.querySelector("#raw-url");
const button = document.querySelector("#copy-url");

function getRawUrl() {
  return new URL(input.value, window.location.origin).toString();
}

input.value = getRawUrl();

button.addEventListener("click", async () => {
  await navigator.clipboard.writeText(getRawUrl());
  button.textContent = "Copied";

  window.setTimeout(() => {
    button.textContent = "Copy";
  }, 1200);
});
