export default function decorate(block) {
  console.log("This is the chat block");
  block.classList.add('chat');
  return block;
}
