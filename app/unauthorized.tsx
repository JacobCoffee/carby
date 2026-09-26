export default function Unauthorized() {
  return (
    <main style={{ maxWidth: "36rem", margin: "4rem auto", padding: "0 1.5rem" }}>
      <h1>Sign-in required</h1>
      <p>Carby shows care records only to a signed-in account.</p>
      <p>No sign-in is configured for this deployment.</p>
    </main>
  );
}
