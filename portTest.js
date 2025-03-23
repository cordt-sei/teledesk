// test-port.js
// Run this script to check if port 3030 is truly available
import net from 'net';

const PORT = 3030;
const HOST = '0.0.0.0';

console.log(`Testing port ${PORT} availability...`);

// Alternative 1: Simple connection test
const client = new net.Socket();
const timeout = 1000;

client.setTimeout(timeout);
client.on('error', (error) => {
  if (error.code === 'ECONNREFUSED') {
    console.log(`Port ${PORT} appears to be available (connection refused).`);
  } else {
    console.error(`Error checking port: ${error.code} - ${error.message}`);
  }
});

client.on('timeout', () => {
  console.log(`Connection to ${HOST}:${PORT} timed out - port may be blocked but not actively used.`);
  client.destroy();
});

client.on('connect', () => {
  console.log(`Port ${PORT} is in use! Connection established.`);
  client.destroy();
});

client.connect(PORT, HOST);

// Alternative 2: Try to bind directly
setTimeout(() => {
  try {
    const server = net.createServer();
    
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use (server binding test).`);
      } else {
        console.error(`Error binding to port: ${err.code} - ${err.message}`);
      }
    });
    
    server.listen(PORT, HOST, () => {
      console.log(`Successfully bound to port ${PORT} - it is available!`);
      server.close();
    });
    
    server.on('close', () => {
      console.log('Server closed after successful test.');
    });
  } catch (err) {
    console.error(`Exception trying to bind to port: ${err.message}`);
  }
}, 2000);

// Alternative 3: Use a different port
setTimeout(() => {
  const ALTERNATIVE_PORT = 3031;
  console.log(`\nTrying alternative port ${ALTERNATIVE_PORT}...`);
  
  try {
    const server = net.createServer();
    
    server.on('error', (err) => {
      console.error(`Error binding to alternative port: ${err.code} - ${err.message}`);
    });
    
    server.listen(ALTERNATIVE_PORT, HOST, () => {
      console.log(`Successfully bound to alternative port ${ALTERNATIVE_PORT} - you could use this instead!`);
      server.close();
    });
  } catch (err) {
    console.error(`Exception trying to bind to alternative port: ${err.message}`);
  }
}, 4000);