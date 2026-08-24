(() => {
  const card = document.querySelector('#flow-card');
  card.dataset.runtimeWidth = String(Math.round(card.getBoundingClientRect().width));
})();
