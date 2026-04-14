export default function Home() {
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>F1 CFD Simulator</h1>
      <p>Simple test page to verify deployment</p>
      <div style={{ 
        width: '100%', 
        height: '400px', 
        backgroundColor: '#0f1117', 
        border: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white',
        marginTop: '20px'
      }}>
        <p>F1 CFD Simulation Area</p>
      </div>
      <p style={{ marginTop: '20px' }}>
        Backend: <a href="https://f1-cfd.onrender.com/health" target="_blank" rel="noopener noreferrer">
          https://f1-cfd.onrender.com
        </a>
      </p>
    </div>
  );
}