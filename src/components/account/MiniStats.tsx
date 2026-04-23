type MiniStatsProps = {
  drinks: number;
  rewards: number;
  stars: number;
  onPressDrinks?: () => void;
  onPressRewards?: () => void;
};

export function MiniStats({
  drinks,
  rewards,
  stars,
  onPressDrinks,
  onPressRewards,
}: MiniStatsProps) {
  return (
    <div className="flex gap-2.5 px-4 mt-3">
      <Tile n={drinks} label="Drinks" onClick={onPressDrinks} />
      <Tile n={rewards} label="Rewards" onClick={onPressRewards} />
      <Tile n={stars} label="Stars" />
    </div>
  );
}

type TileProps = {
  n: number;
  label: string;
  onClick?: () => void;
};

function Tile({ n, label, onClick }: TileProps) {
  const content = (
    <>
      <span
        className="block font-serif text-ink"
        style={{
          fontSize: 22,
          lineHeight: "24px",
          letterSpacing: -0.4,
          fontWeight: 500,
        }}
      >
        {n}
      </span>
      <span
        className="block font-mono uppercase text-ink3 mt-1"
        style={{
          fontSize: 10.5,
          letterSpacing: 1.3,
          fontWeight: 700,
        }}
      >
        {label}
      </span>
    </>
  );

  if (!onClick) {
    return (
      <div className="flex-1 rounded-tile border border-line bg-paper py-3 px-2.5">
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-tile border border-line bg-paper py-3 px-2.5 text-left transition active:opacity-75 active:bg-cream"
    >
      {content}
    </button>
  );
}
