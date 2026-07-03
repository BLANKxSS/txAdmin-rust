type AdPlacement = 'login' | 'sidebar';

type DynamicAdvertProps = {
    placement: AdPlacement;
};

//RUSTTODO: FiveM hosting partner adverts removed for the Rust standalone version
export default function DynamicAdvert({ placement }: DynamicAdvertProps) {
    return null;
}
