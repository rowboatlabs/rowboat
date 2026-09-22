let count = 0;
document.addEventListener('keydown', (event) => {
  document.querySelector('#key').textContent = event.key;
});
document.querySelector('#increment').addEventListener('click', () => {
  document.querySelector('#counter').textContent = `Count: ${++count}`;
});
document.querySelector('#form').addEventListener('submit', (event) => {
  event.preventDefault();
  document.querySelector('#result').textContent = `Submitted: ${document.querySelector('#name').value}`;
});
