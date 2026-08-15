// Derived from SJMCL (https://github.com/UNIkeEN/SJMCL), GPL-3.0.
import { ReactNode, forwardRef } from "react";
import cardStyles from "../styles/card.module.css";
import liquidGlassStyles from "../styles/liquid-glass.module.css";

interface AdvancedCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: string;
  level?: "back" | "front";
  children?: ReactNode;
}

const AdvancedCard = forwardRef<HTMLDivElement, AdvancedCardProps>(
  ({ variant = "liquid-glass", level = "back", children, ...props }, ref) => {
    if (variant === "liquid-glass") {
      return (
        <div
          ref={ref}
          {...props}
          className={`${liquidGlassStyles["wrapper"]} ${props.className || ""}`}
        >
          <div className={liquidGlassStyles["effect"]} />
          <div className={liquidGlassStyles["shine"]} />
          <div
            className="h-full w-full"
            style={{ position: "relative", zIndex: 3 }}
          >
            {children}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        {...props}
        className={`${cardStyles[`card-${level}`]} ${props.className || ""}`}
      >
        {children}
      </div>
    );
  }
);

AdvancedCard.displayName = "AdvancedCard";

export default AdvancedCard;
