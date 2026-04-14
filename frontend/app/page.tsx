export default function Home() {
  return (
    <div style={{ padding: '20px', textAlign: 'center' }}>
      <h1>F1 CFD Simulator</h1>
      <p>Loading 3D simulation...</p>
      <div style={{ 
        width: '100%', 
        height: '400px', 
        backgroundColor: '#0f1117', 
        border: '1px solid #333',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'white'
      }}>
        <p>3D Simulation Area</p>
      </div>
    </div>
  );
}
