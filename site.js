const rawInput = document.querySelector("#raw-url");
const copyFirstButton = document.querySelector("#copy-url");
const keyInput = document.querySelector("#user-key");
const copyKeyedButton = document.querySelector("#copy-keyed-loader");
const loaderPreview = document.querySelector("#loader-preview");

function endpointUrl(key) {
  const url = new URL("/api/script", window.location.origin);

  if (key) {
    url.searchParams.set("null", key);
  }

  return url.toString();
}

function loaderFor(key) {
  return `loadstring(game:HttpGet("${endpointUrl(key)}"))()`;
}

function updatePreview() {
  const key = keyInput.value.trim();
  rawInput.value = loaderFor("");
  loaderPreview.value = loaderFor(key || "YOUR_KEY");
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied";

  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

copyFirstButton.addEventListener("click", () => {
  copyText(loaderFor(""), copyFirstButton);
});

copyKeyedButton.addEventListener("click", () => {
  copyText(loaderFor(keyInput.value.trim() || "YOUR_KEY"), copyKeyedButton);
});

keyInput.addEventListener("input", updatePreview);
updatePreview();
