//RUSTTODO: Pre-release expiration check (not applicable for Rust standalone)
// This is a no-op for Rust builds, kept only for API compatibility.

export default () => {
    //Pre-release expiration is not applicable for Rust server builds
    return;
};
