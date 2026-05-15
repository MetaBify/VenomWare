const keyInput = document.querySelector("#user-key");
const copyRegularButton = document.querySelector("#copy-regular-loader");
const copyTestButton = document.querySelector("#copy-test-loader");
const regularLoaderPreview = document.querySelector("#regular-loader-preview");
const testLoaderPreview = document.querySelector("#test-loader-preview");

function endpointUrl(path, key) {
  const url = new URL(path, window.location.origin);

  if (key) {
    url.searchParams.set("null", key);
  }

  return url.toString();
}

function verifyUrl() {
  return new URL("/api/verify", window.location.origin).toString();
}

function luaString(value) {
  return JSON.stringify(String(value || ""));
}

function loaderFor(path, key) {
  return `getgenv().key=${luaString(key)};getgenv().venom_auth_verify_url=${luaString(verifyUrl())};loadstring(game:HttpGet(${luaString(endpointUrl(path, key))}))()`;
}

function regularLoaderFor(key) {
  return loaderFor("/api/script", key);
}

function testLoaderFor(key) {
  return loaderFor("/api/test-script", key);
}

function updatePreview() {
  const key = keyInput.value.trim();
  regularLoaderPreview.value = regularLoaderFor(key || "YOUR_KEY");
  testLoaderPreview.value = testLoaderFor(key || "YOUR_KEY");
}

async function copyText(text, button) {
  await navigator.clipboard.writeText(text);
  const original = button.textContent;
  button.textContent = "Copied";

  window.setTimeout(() => {
    button.textContent = original;
  }, 1200);
}

copyRegularButton.addEventListener("click", () => {
  copyText(regularLoaderFor(keyInput.value.trim() || "YOUR_KEY"), copyRegularButton);
});

copyTestButton.addEventListener("click", () => {
  copyText(testLoaderFor(keyInput.value.trim() || "YOUR_KEY"), copyTestButton);
});

keyInput.addEventListener("input", updatePreview);
updatePreview();
