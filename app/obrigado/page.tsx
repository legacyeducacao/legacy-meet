export default function ObrigadoPage() {
  return (
    <main
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        padding: '2rem',
        textAlign: 'center',
        background:
          'radial-gradient(circle at 50% 25%, rgba(39, 82, 134, 0.35) 0%, transparent 55%), linear-gradient(160deg, #050d18 0%, #0a1c3a 100%)',
        color: '#fff',
      }}
    >
      <div style={{ maxWidth: 420 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/favicon.svg"
          alt="Legacy Meet"
          width={64}
          height={64}
          style={{ marginBottom: '1.25rem', filter: 'drop-shadow(0 6px 18px rgba(0,0,0,0.45))' }}
        />
        <h1 style={{ fontSize: '1.8rem', fontWeight: 700, margin: '0 0 0.6rem' }}>
          Obrigado pela sua participação!
        </h1>
        <p style={{ color: 'rgba(255, 255, 255, 0.7)', lineHeight: 1.5, margin: 0 }}>
          A reunião foi encerrada. Você já pode fechar esta janela.
        </p>
      </div>
    </main>
  );
}
